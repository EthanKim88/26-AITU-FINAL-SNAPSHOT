import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/api";

export async function GET() {
  try {
    const [
      domains,
      adHosts,
      domainCreds,
      checklists,
    ] = await Promise.all([
      prisma.adDomain.findMany({
        include: {
          _count: { select: { users: true, groups: true, computers: true, trusts: true, gpos: true } },
          users: { where: { OR: [{ kerberoastable: true }, { asrepRoastable: true }, { adminCount: true }] } },
          computers: { where: { isDc: true } },
        },
        orderBy: { scanTime: "desc" },
      }),
      // AD hosts: isDc=true OR domain is not empty
      prisma.host.findMany({
        where: { OR: [{ isDc: true }, { domain: { not: "" } }] },
        include: {
          ports: { orderBy: { port: "asc" } },
          checklists: {
            include: { session: { select: { id: true, title: true, status: true } } },
          },
          accesses: {
            include: {
              credential: { select: { id: true, username: true, domain: true, credType: true, secretType: true } },
            },
          },
        },
        orderBy: { ip: "asc" },
      }),
      prisma.credential.findMany({
        where: { credType: "domain" },
        include: {
          accesses: {
            include: { host: { select: { id: true, ip: true, hostname: true } } },
          },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.attackChecklist.findMany({
        where: {
          host: { OR: [{ isDc: true }, { domain: { not: "" } }] },
        },
        include: {
          host: { select: { id: true, ip: true, hostname: true, os: true, domain: true, isDc: true } },
          session: { select: { id: true, title: true, status: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    // Stats
    const kerberoastable = domains.reduce((s, d) => s + d.users.filter(u => u.kerberoastable).length, 0);
    const asrepRoastable = domains.reduce((s, d) => s + d.users.filter(u => u.asrepRoastable).length, 0);
    const adminCountUsers = domains.reduce((s, d) => s + d.users.filter(u => u.adminCount).length, 0);
    const dcComputers = domains.reduce((s, d) => s + d.computers.length, 0);
    const validAccesses = domainCreds.flatMap(c => c.accesses.filter(a => a.status === "valid"));
    const adminAccesses = validAccesses.filter(a => a.isAdmin);

    return apiSuccess({
      stats: {
        domainCount: domains.length,
        adHostCount: adHosts.length,
        domainCredCount: domainCreds.length,
        userCount: domains.reduce((s, d) => s + d._count.users, 0),
        groupCount: domains.reduce((s, d) => s + d._count.groups, 0),
        computerCount: domains.reduce((s, d) => s + d._count.computers, 0),
        kerberoastable,
        asrepRoastable,
        adminCountUsers,
        dcComputers,
        validAccessCount: validAccesses.length,
        adminAccessCount: adminAccesses.length,
      },
      // Clean domain data for serialization (remove nested users/computers used for stats)
      domains: domains.map(d => ({
        id: d.id,
        domainName: d.domainName,
        dcIp: d.dcIp,
        functionalLevel: d.functionalLevel,
        forestLevel: d.forestLevel,
        dcLevel: d.dcLevel,
        dnsHostname: d.dnsHostname,
        serverName: d.serverName,
        passwordPolicy: d.passwordPolicy,
        attackRecommendations: d.attackRecommendations,
        scanTime: d.scanTime,
        _count: d._count,
      })),
      adHosts,
      domainCreds,
      checklists,
    });
  } catch (e) {
    console.error("Failed to fetch AD summary:", e);
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}
