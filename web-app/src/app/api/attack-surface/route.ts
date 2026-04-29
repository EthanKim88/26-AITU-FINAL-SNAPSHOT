import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/api";

export async function GET() {
  try {
    const [hosts, credentials, adDomains, scadaDevices] = await Promise.all([
      prisma.host.findMany({
        include: { ports: true, accesses: true, checklists: true },
      }),
      prisma.credential.findMany({
        include: { accesses: true },
      }),
      prisma.adDomain.findMany({
        include: { users: true, computers: true },
      }),
      prisma.scadaDevice.findMany({
        include: { registers: { where: { isNonZero: true } } },
      }),
    ]);

    // Hosts without checklists
    const hostsWithoutChecklist = hosts.filter((h) => h.checklists.length === 0);

    // Hosts with checklists but all phases still pending
    const pendingHosts = hosts.filter((h) =>
      h.checklists.length > 0 && h.checklists.every((c) => c.enumStatus === "pending")
    );

    // Hosts with any phase in-progress
    const STATUS_KEYS = ["enumStatus", "exploitStatus", "privescStatus"] as const;
    const inProgressHosts = hosts.filter((h) =>
      h.checklists.some((c) =>
        STATUS_KEYS.some((k) => (c as Record<string, unknown>)[k] === "in-progress")
      )
    );

    // Hosts with SMB signing disabled
    const smbSigningDisabled = hosts.filter((h) => h.smbSigning === false);

    // Kerberoastable & ASREProastable users
    const kerbUsers = adDomains.flatMap((d) => d.users.filter((u) => u.kerberoastable));
    const asrepUsers = adDomains.flatMap((d) => d.users.filter((u) => u.asrepRoastable));

    // Untested credential combos
    const untestedCreds = credentials
      .map((c) => ({
        id: c.id, username: c.username, credType: c.credType, domain: c.domain,
        untestedCount: c.accesses.filter((a) => a.status === "untested").length,
        totalHosts: hosts.length,
        testedHosts: c.accesses.length,
      }))
      .filter((c) => c.testedHosts < hosts.length);

    // Recommendations
    const recommendations: { host?: string; action: string; reason: string; priority: string }[] = [];

    for (const h of hosts) {
      const portNums = h.ports.map((p) => p.port);
      if (h.smbSigning === false) {
        recommendations.push({ host: h.ip, action: "ntlmrelayx / PetitPotam", reason: "SMB signing disabled", priority: "high" });
      }
      if (portNums.includes(636) || portNums.includes(3269)) {
        recommendations.push({ host: h.ip, action: "certipy find", reason: "LDAPS port open = ADCS possible", priority: "medium" });
      }
      if (portNums.includes(1433)) {
        recommendations.push({ host: h.ip, action: "xp_cmdshell / MSSQL abuse", reason: "MSSQL port open", priority: "medium" });
      }
    }

    for (const u of kerbUsers) {
      recommendations.push({ action: `GetUserSPNs ${u.username}`, reason: "Kerberoastable account", priority: "high" });
    }
    for (const u of asrepUsers) {
      recommendations.push({ action: `GetNPUsers ${u.username}`, reason: "ASREProastable account", priority: "high" });
    }

    // Non-zero SCADA registers
    const nonZeroRegisters = scadaDevices.flatMap((d) =>
      d.registers.map((r) => ({ device: d.host, register: `${r.registerType}:${r.address}`, value: r.decodedValue }))
    );

    return apiSuccess({
      unexploredHosts: hostsWithoutChecklist.map((h) => ({
        ip: h.ip, ports: h.ports.map((p) => p.port),
      })),
      pendingHosts: pendingHosts.map((h) => ({
        ip: h.ip, ports: h.ports.map((p) => p.port),
        sessionId: h.checklists[0]?.sessionId ?? null,
      })),
      inProgressHosts: inProgressHosts.map((h) => {
        const cl = h.checklists[0];
        return {
          ip: h.ip,
          sessionId: cl?.sessionId ?? null,
          enumStatus: cl?.enumStatus,
          exploitStatus: cl?.exploitStatus,
          privescStatus: cl?.privescStatus,
        };
      }),
      smbSigningDisabled: smbSigningDisabled.map((h) => h.ip),
      kerberoastableUsers: kerbUsers.map((u) => u.username),
      asrepRoastableUsers: asrepUsers.map((u) => u.username),
      untestedCredentials: untestedCreds,
      nonZeroRegisters,
      recommendations,
    });
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}
