import os from "os";
import { prisma } from "@/lib/prisma";
import { BattleMapClient } from "@/components/battle-map/battle-map-client";

function getVpnIp(): string {
  const interfaces = os.networkInterfaces();
  for (const [name, addrs] of Object.entries(interfaces)) {
    if (name.startsWith("utun") || name.startsWith("tun") || name.startsWith("wg")) {
      for (const addr of addrs ?? []) {
        if (addr.family === "IPv4" && !addr.internal) {
          return addr.address;
        }
      }
    }
  }
  return "";
}

export default async function BattleMapPage() {
  const segments = await prisma.networkSegment.findMany({
    orderBy: [{ scope: "asc" }, { order: "asc" }, { name: "asc" }],
    include: {
      ownerHost: { select: { id: true, ip: true, hostname: true } },
      hostLinks: {
        include: {
          host: {
            include: {
              ports: { select: { port: true, protocol: true, service: true, version: true, state: true } },
              routes: {
                select: {
                  id: true,
                  destination: true,
                  gateway: true,
                  iface: true,
                  srcIp: true,
                  connectedIp: true,
                  isDefault: true,
                  isConnected: true,
                },
                orderBy: [{ isDefault: "desc" }, { destination: "asc" }, { iface: "asc" }],
              },
            },
          },
        },
      },
    },
  });

  const reportTargetIps = [...new Set(
    segments.flatMap((segment) =>
      segment.hostLinks.flatMap((link) => [link.host.ip, link.ip || link.host.ip])
    ).filter((ip) => ip.length > 0)
  )];

  const [hosts, credentials, credentialAccesses, reportsByIpAndType, pendingReports, events, pivotRoutes] = await Promise.all([
    prisma.host.count(),
    prisma.credential.count(),
    prisma.credentialAccess.findMany({
      select: { status: true, isAdmin: true },
    }),
    prisma.report.groupBy({
      by: ["targetIp", "reportType"],
      where: {
        targetIp: { in: reportTargetIps },
      },
      _count: { _all: true },
    }),
    prisma.report.count({
      where: {
        status: "pending",
        targetIp: { in: reportTargetIps },
      },
    }),
    prisma.event.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
    prisma.pivotRoute.findMany({
      include: {
        fromSegment: { select: { id: true, name: true } },
        toSegment: { select: { id: true, name: true } },
        pivotHost: { select: { id: true, ip: true, hostname: true } },
      },
    }),
  ]);

  const reportCountByIp = new Map<string, { total: number; bugBounty: number; risk: number }>();
  let totalBugBountyReports = 0;
  let totalRiskReports = 0;
  for (const row of reportsByIpAndType) {
    const targetIp = row.targetIp.trim();
    if (!targetIp) continue;
    const count = Number(row._count?._all ?? 0);
    if (!Number.isFinite(count) || count <= 0) continue;
    const current = reportCountByIp.get(targetIp) ?? { total: 0, bugBounty: 0, risk: 0 };
    current.total = Number(current.total || 0) + count;
    if (row.reportType === "bug_bounty") {
      current.bugBounty = Number(current.bugBounty || 0) + count;
      totalBugBountyReports += count;
    } else if (row.reportType === "risk") {
      current.risk = Number(current.risk || 0) + count;
      totalRiskReports += count;
    }
    reportCountByIp.set(targetIp, current);
  }

  const credValid = credentialAccesses.filter((a) => a.status === "valid").length;
  const credAdmin = credentialAccesses.filter((a) => a.status === "valid" && a.isAdmin).length;
  const credTested = credentialAccesses.filter((a) => a.status !== "untested").length;

  const dashboardData = {
    vpnIp: getVpnIp(),
    stats: {
      totalHosts: hosts,
      totalCredentials: credentials,
      totalReports: totalBugBountyReports + totalRiskReports,
      pendingReports,
      reportTypeTotals: {
        bugBounty: totalBugBountyReports,
        risk: totalRiskReports,
      },
    },
    segments: segments.map((s) => ({
      id: s.id,
      name: s.name,
      cidr: s.cidr,
      scope: s.scope,
      ownerHost: s.ownerHost,
      reachable: s.reachable,
      hostCount: s.hostLinks.length,
      hosts: s.hostLinks.map((hl) => {
        const ips = new Set([hl.host.ip, hl.ip || hl.host.ip]);
        let reportCount = 0;
        let reportBugBountyCount = 0;
        let reportRiskCount = 0;
        for (const ip of ips) {
          const counts = reportCountByIp.get(ip);
          if (!counts) continue;
          reportCount += Number(counts.total || 0);
          reportBugBountyCount += Number(counts.bugBounty || 0);
          reportRiskCount += Number(counts.risk || 0);
        }
        return {
          id: hl.host.id,
          ip: hl.host.ip,
          segmentIp: hl.ip || hl.host.ip,
          hostname: hl.host.hostname,
          os: hl.host.os,
          status: hl.host.status,
          isDc: hl.host.isDc,
          portCount: hl.host.ports.length,
          ports: hl.host.ports
            .filter((p) => p.state === "open")
            .map((p) => ({ port: p.port, protocol: p.protocol, service: p.service, version: p.version })),
          routes: hl.host.routes.map((route) => ({
            id: route.id,
            destination: route.destination,
            gateway: route.gateway,
            iface: route.iface,
            srcIp: route.srcIp,
            connectedIp: route.connectedIp,
            isDefault: route.isDefault,
            isConnected: route.isConnected,
          })),
          connectedIps: [...new Set(hl.host.routes
            .map((route) => route.connectedIp || route.srcIp)
            .filter((ip) => ip.length > 0))],
          reportCount,
          reportBugBountyCount,
          reportRiskCount,
        };
      }).sort((a, b) => {
        const pa = a.ip.split(".").map(Number);
        const pb = b.ip.split(".").map(Number);
        for (let i = 0; i < 4; i++) { if (pa[i] !== pb[i]) return pa[i] - pb[i]; }
        return 0;
      }),
    })).map((segment) => ({
      ...segment,
      reportCount: segment.hosts.reduce((sum, host) => sum + Number(host.reportCount || 0), 0),
      reportBugBountyCount: segment.hosts.reduce((sum, host) => sum + Number(host.reportBugBountyCount || 0), 0),
      reportRiskCount: segment.hosts.reduce((sum, host) => sum + Number(host.reportRiskCount || 0), 0),
    })),
    pivotRoutes: JSON.parse(JSON.stringify(pivotRoutes.map((r) => ({
      id: r.id,
      fromSegmentId: r.fromSegmentId,
      toSegmentId: r.toSegmentId,
      pivotHost: r.pivotHost,
      protocol: r.protocol,
      port: r.port,
      status: r.status,
    })))),
    recentEvents: JSON.parse(JSON.stringify(events)),
    credentialSummary: { total: credentials, tested: credTested, valid: credValid, admin: credAdmin },
  };

  return <BattleMapClient initialData={dashboardData} />;
}
