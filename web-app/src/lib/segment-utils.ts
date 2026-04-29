import { prisma } from "@/lib/prisma";

const HOST_LOCAL_IFACE_PATTERNS: RegExp[] = [
  /^docker\d*$/i,
  /^br-[0-9a-f]+$/i,
  /^cni\d*$/i,
  /^virbr\d*$/i,
  /^podman\d*$/i,
  /^veth[a-z0-9]+$/i,
];

/** Check if an IP falls within a CIDR range. */
function ipInCidr(ip: string, cidr: string): boolean {
  const parts = cidr.split("/");
  if (parts.length !== 2) return false;
  const [network, prefixStr] = parts;
  const prefix = parseInt(prefixStr, 10);
  if (isNaN(prefix) || prefix < 0 || prefix > 32) return false;

  const ipNum = ipToNum(ip);
  const netNum = ipToNum(network);
  if (ipNum === null || netNum === null) return false;

  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return (ipNum & mask) === (netNum & mask);
}

function ipToNum(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let num = 0;
  for (const p of parts) {
    const v = parseInt(p, 10);
    if (isNaN(v) || v < 0 || v > 255) return null;
    num = (num << 8) | v;
  }
  return num >>> 0;
}

/** Check if two CIDRs overlap (one contains the other). */
function cidrsOverlap(a: string, b: string): boolean {
  const pa = parseCidrRange(a);
  const pb = parseCidrRange(b);
  if (!pa || !pb) return false;
  // a contains b?
  if (pa.prefix <= pb.prefix && (pb.network & pa.mask) === pa.network) return true;
  // b contains a?
  if (pb.prefix <= pa.prefix && (pa.network & pb.mask) === pb.network) return true;
  return false;
}

function parseCidrRange(cidr: string): { network: number; prefix: number; mask: number } | null {
  const parts = cidr.split("/");
  if (parts.length !== 2) return null;
  const prefix = parseInt(parts[1], 10);
  if (isNaN(prefix) || prefix < 0 || prefix > 32) return null;
  const network = ipToNum(parts[0]);
  if (network === null) return null;
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return { network: network & mask, prefix, mask };
}

function isLikelyHostLocalInterface(iface: string): boolean {
  const normalized = iface.trim();
  if (!normalized) return false;
  return HOST_LOCAL_IFACE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function buildHostLocalSegmentName(hostIp: string, iface: string, cidr: string): string {
  return `Local ${cidr} @ ${hostIp} (${iface})`;
}

function hostLocalInterfacePriority(iface: string): number {
  const normalized = iface.trim().toLowerCase();
  if (/^docker\d*$/.test(normalized)) return 100;
  if (/^podman\d*$/.test(normalized)) return 95;
  if (/^cni\d*$/.test(normalized)) return 90;
  if (/^br-[0-9a-f]+$/.test(normalized)) return 85;
  if (/^virbr\d*$/.test(normalized)) return 70;
  if (/^veth[a-z0-9]+$/.test(normalized)) return 10;
  return 0;
}

/**
 * Create/update host-local segments from a host's connected route data.
 * Example: docker0/cni0 routes become `scope=host-local` segments
 * owned by that host, so overlapping CIDRs across hosts are disambiguated.
 */
export async function syncHostLocalSegmentsFromRoutes(hostId: string): Promise<number> {
  const host = await prisma.host.findUnique({
    where: { id: hostId },
    select: {
      id: true,
      ip: true,
      routes: {
        where: { isConnected: true },
        select: { destination: true, iface: true, connectedIp: true, srcIp: true },
      },
    },
  });

  if (!host) return 0;

  const candidates = new Map<string, { iface: string; prefix: number; priority: number; connectedIp: string }>();
  for (const route of host.routes) {
    const cidr = route.destination.trim();
    const iface = route.iface.trim();
    if (!cidr || !iface) continue;
    const parsed = parseCidrRange(cidr);
    if (!parsed) continue;
    if (!isLikelyHostLocalInterface(iface)) continue;
    const priority = hostLocalInterfacePriority(iface);
    const connectedIp = (route.connectedIp || route.srcIp || "").trim();

    const existing = candidates.get(cidr);
    if (!existing) {
      candidates.set(cidr, { iface, prefix: parsed.prefix, priority, connectedIp });
      continue;
    }
    if (!existing.connectedIp && connectedIp) {
      candidates.set(cidr, { ...existing, connectedIp });
    }
  }

  const selected = [...candidates.entries()]
    .sort((a, b) => {
      // Highest interface priority first, then broader CIDR (/16 before /24), then lexical.
      if (b[1].priority !== a[1].priority) return b[1].priority - a[1].priority;
      if (a[1].prefix !== b[1].prefix) return a[1].prefix - b[1].prefix;
      return a[0].localeCompare(b[0]);
    })[0];

  await prisma.$transaction(async (tx) => {
    const currentLocal = await tx.networkSegment.findMany({
      where: { scope: "host-local", ownerHostId: host.id },
      select: { id: true, cidr: true },
    });

    const keepCidr = selected?.[0] ?? null;
    if (selected) {
      const [cidr, info] = selected;
      const where = {
        scope_ownerHostId_cidr: {
          scope: "host-local",
          ownerHostId: host.id,
          cidr,
        },
      } as const;

      const existing = await tx.networkSegment.findUnique({
        where,
        select: { id: true },
      });

      const segment = existing
        ? await tx.networkSegment.update({
          where,
          data: {
            name: buildHostLocalSegmentName(host.ip, info.iface, cidr),
            description: `Auto-discovered host-local segment on ${host.ip} via ${info.iface}`,
            reachable: false,
          },
        })
        : await tx.networkSegment.create({
          data: {
            name: buildHostLocalSegmentName(host.ip, info.iface, cidr),
            cidr,
            description: `Auto-discovered host-local segment on ${host.ip} via ${info.iface}`,
            scope: "host-local",
            ownerHostId: host.id,
            reachable: false,
          },
        });

      await tx.hostSegment.upsert({
        where: {
          hostId_segmentId: {
            hostId: host.id,
            segmentId: segment.id,
          },
        },
        create: {
          hostId: host.id,
          segmentId: segment.id,
          ip: info.connectedIp || host.ip,
        },
        update: {
          ip: info.connectedIp || host.ip,
        },
      });
    }

    const stale = currentLocal.filter((seg) => seg.cidr !== keepCidr);
    if (stale.length === 0) return;

    const staleIds = stale.map((seg) => seg.id);
    await tx.hostSegment.deleteMany({
      where: { hostId: host.id, segmentId: { in: staleIds } },
    });

    for (const staleId of staleIds) {
      const remainingLinks = await tx.hostSegment.count({
        where: { segmentId: staleId },
      });
      if (remainingLinks > 0) continue;
      try {
        await tx.networkSegment.delete({ where: { id: staleId } });
      } catch {
        // Keep the segment if referenced elsewhere (e.g., unexpected pivot route).
      }
    }
  });

  return selected ? 1 : 0;
}

/**
 * Auto-assign hosts to segments based on CIDR matching.
 * Skips assignment if the host already belongs to a segment whose CIDR
 * overlaps with the candidate — prevents duplicating hosts across
 * overlapping subnets like /16 and /24.
 * For new hosts with no segments, assigns to the most specific match.
 */
export async function autoAssignSegments(): Promise<number> {
  const segments = await prisma.networkSegment.findMany({
    where: { cidr: { not: "" }, scope: "global" },
  });
  if (segments.length === 0) return 0;

  const hosts = await prisma.host.findMany({
    select: {
      id: true,
      ip: true,
      segments: {
        include: { segment: true },
        where: { segment: { scope: "global" } },
      },
    },
  });
  let created = 0;

  for (const host of hosts) {
    // CIDRs of segments the host already belongs to
    const existingCidrs = host.segments
      .map((hs) => hs.segment.cidr)
      .filter((c) => c !== "");

    for (const seg of segments) {
      if (!ipInCidr(host.ip, seg.cidr)) continue;

      // Already assigned to this segment
      if (host.segments.some((hs) => hs.segmentId === seg.id)) continue;

      // Skip if host already belongs to an overlapping segment
      if (existingCidrs.some((c) => cidrsOverlap(c, seg.cidr))) continue;

      await prisma.hostSegment.create({
        data: { hostId: host.id, segmentId: seg.id, ip: host.ip },
      });
      created++;
      existingCidrs.push(seg.cidr);
    }
  }

  return created;
}
