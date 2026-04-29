import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/api";

export async function GET() {
  try {
    const [segments, hosts, credentials, events, adDomains, scadaDevices, checklists] = await Promise.all([
      prisma.networkSegment.findMany({
        orderBy: [{ scope: "asc" }, { order: "asc" }, { name: "asc" }],
        include: {
          hostLinks: true,
          ownerHost: { select: { id: true, ip: true, hostname: true } },
        },
      }),
      prisma.host.findMany({
        orderBy: { ip: "asc" },
        include: {
          segments: {
            include: {
              segment: {
                include: {
                  ownerHost: { select: { id: true, ip: true, hostname: true } },
                },
              },
            },
          },
          ports: true,
          routes: true,
          accesses: { include: { credential: true } },
        },
      }),
      prisma.credential.findMany({ include: { accesses: { include: { host: { select: { ip: true } } } } } }),
      prisma.event.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
      prisma.adDomain.findMany({
        include: { users: true, groups: true, computers: true, trusts: true, gpos: true },
      }),
      prisma.scadaDevice.findMany({ include: { registers: true } }),
      prisma.attackChecklist.findMany({ include: { session: { select: { id: true, title: true } } } }),
    ]);

    const credAccesses = credentials.flatMap((c) => c.accesses);
    return apiSuccess({
      segments: segments.map((s) => ({
        id: s.id,
        name: s.name,
        cidr: s.cidr,
        scope: s.scope,
        ownerHost: s.ownerHost,
        hostCount: s.hostLinks.length,
      })),
      hosts: {
        total: hosts.length,
        unassigned: hosts.filter((h) => h.segments.length === 0).length,
        routeMapped: hosts.filter((h) => h.routes.length > 0).length,
      },
      credentials: {
        total: credentials.length,
        valid: credAccesses.filter((a) => a.status === "valid").length,
        admin: credAccesses.filter((a) => a.status === "valid" && a.isAdmin).length,
        untested: credAccesses.filter((a) => a.status === "untested").length,
      },
      recentEvents: events.slice(0, 10),
      ad: {
        domains: adDomains.length,
        users: adDomains.reduce((s, d) => s + d.users.length, 0),
      },
      scada: {
        devices: scadaDevices.length,
        nonZeroRegisters: scadaDevices.reduce((s, d) => s + d.registers.filter((r) => r.isNonZero).length, 0),
      },
      checklists: {
        total: checklists.length,
        pending: checklists.filter((c) => c.enumStatus === "pending").length,
        inProgress: checklists.filter((c) =>
          [c.enumStatus, c.exploitStatus, c.privescStatus].includes("in-progress")
        ).length,
        done: checklists.filter((c) => c.privescStatus === "done").length,
        sessions: [...new Set(checklists.filter((c) => c.sessionId).map((c) => c.sessionId))].map((sid) => ({
          sessionId: sid,
          title: checklists.find((c) => c.sessionId === sid)?.session?.title ?? "",
          hostCount: checklists.filter((c) => c.sessionId === sid).length,
        })),
      },
    });
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}
