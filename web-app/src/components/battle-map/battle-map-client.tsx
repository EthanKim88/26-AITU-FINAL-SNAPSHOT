"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import dynamic from "next/dynamic";
import { Badge } from "@/components/ui/badge";
import {
  FileText, Shield, Monitor, KeyRound, User, Wifi, WifiOff, Network, X,
} from "lucide-react";
import { apiGet } from "@/lib/fetcher";
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
  Position,
  MarkerType,
  Handle,
  useNodesState,
  useEdgesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

/* ─── Types ─── */

interface PortInfo { port: number; protocol: string; service: string; version: string; }
interface HostRouteInfo {
  id: string;
  destination: string;
  gateway: string;
  iface: string;
  srcIp: string;
  connectedIp: string;
  isDefault: boolean;
  isConnected: boolean;
}

interface HostInfo {
  [key: string]: unknown;
  id: string; ip: string; hostname: string; os: string;
  segmentIp?: string;
  uiHeight?: number;
  status: string; isDc: boolean; portCount: number;
  ports: PortInfo[];
  routes: HostRouteInfo[];
  connectedIps: string[];
  reportCount: number;
  reportBugBountyCount: number;
  reportRiskCount: number;
}

interface SegmentData {
  id: string;
  name: string;
  cidr: string;
  scope?: string;
  ownerHost?: { id: string; ip: string; hostname: string } | null;
  reachable: boolean;
  hostCount: number;
  reportCount: number;
  reportBugBountyCount: number;
  reportRiskCount: number;
  hosts: HostInfo[];
}

interface PivotRouteData {
  id: string; fromSegmentId: string; toSegmentId: string;
  pivotHost: { id: string; ip: string; hostname: string };
  protocol: string; port: number; status: string;
}

interface DashboardData {
  vpnIp: string;
  stats: {
    totalHosts: number;
    totalCredentials: number;
    totalReports: number;
    pendingReports: number;
    reportTypeTotals?: {
      bugBounty?: number;
      risk?: number;
    };
  };
  segments: SegmentData[];
  pivotRoutes: PivotRouteData[];
  recentEvents: { id: string; type: string; category: string; message: string; host: string; createdAt: string }[];
  credentialSummary: { total: number; tested: number; valid: number; admin: number };
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function mergeDashboardData(prev: DashboardData, next: DashboardData): DashboardData {
  const prevSegments = new Map(prev.segments.map((segment) => [segment.id, segment]));

  const segments = next.segments.map((segment) => {
    const prevSegment = prevSegments.get(segment.id);
    const prevHosts = new Map((prevSegment?.hosts ?? []).map((host) => [host.id, host]));

    const hosts = segment.hosts.map((host) => {
      const prevHost = prevHosts.get(host.id);
      const reportCount = toFiniteNumber(host.reportCount, toFiniteNumber(prevHost?.reportCount, 0));
      const reportBugBountyCount = toFiniteNumber(host.reportBugBountyCount, toFiniteNumber(prevHost?.reportBugBountyCount, 0));
      const reportRiskCount = toFiniteNumber(host.reportRiskCount, toFiniteNumber(prevHost?.reportRiskCount, 0));

      return {
        ...host,
        reportCount,
        reportBugBountyCount,
        reportRiskCount,
      };
    });

    return {
      ...segment,
      hosts,
      reportCount: hosts.reduce((sum, host) => sum + toFiniteNumber(host.reportCount, 0), 0),
      reportBugBountyCount: hosts.reduce((sum, host) => sum + toFiniteNumber(host.reportBugBountyCount, 0), 0),
      reportRiskCount: hosts.reduce((sum, host) => sum + toFiniteNumber(host.reportRiskCount, 0), 0),
    };
  });

  const reportTypeTotals = next.stats.reportTypeTotals ?? prev.stats.reportTypeTotals ?? { bugBounty: 0, risk: 0 };

  return {
    ...next,
    stats: {
      ...next.stats,
      totalReports: toFiniteNumber(next.stats.totalReports, toFiniteNumber(prev.stats.totalReports, 0)),
      pendingReports: toFiniteNumber(next.stats.pendingReports, toFiniteNumber(prev.stats.pendingReports, 0)),
      reportTypeTotals: {
        bugBounty: toFiniteNumber(reportTypeTotals.bugBounty, 0),
        risk: toFiniteNumber(reportTypeTotals.risk, 0),
      },
    },
    segments,
  };
}

/* ─── Layout constants ─── */

const HOST_W = 190;
const HOST_H = 90;
const HOST_GAP = 10;
const SEG_PAD = 14;
const HOST_COLS_MAX = 1;
const HOST_LOCAL_IFACE_PATTERNS: RegExp[] = [
  /^docker\d*$/i,
  /^br-[0-9a-f]+$/i,
  /^lxcbr\d*$/i,
  /^cni\d*$/i,
  /^virbr\d*$/i,
  /^podman\d*$/i,
  /^veth[a-z0-9]+$/i,
];

function isLikelyHostLocalInterface(iface: string): boolean {
  if (!iface) return false;
  return HOST_LOCAL_IFACE_PATTERNS.some((pattern) => pattern.test(iface.trim()));
}

function estimateWrappedLines(text: string, maxCharsPerLine: number): number {
  const trimmed = text.trim();
  if (!trimmed) return 1;
  if (maxCharsPerLine <= 1) return trimmed.length;
  return Math.max(1, Math.ceil(trimmed.length / maxCharsPerLine));
}

function estimateHeaderHeight(segmentName: string, width: number): number {
  // Segment title width depends on the icon and right-side status area.
  const textAreaWidth = Math.max(80, width - 120);
  const charsPerLine = Math.max(12, Math.floor(textAreaWidth / 8));
  const titleLines = estimateWrappedLines(segmentName, charsPerLine);
  const baseHeaderHeight = 76;
  return baseHeaderHeight + Math.max(0, titleLines - 1) * 18;
}

function estimateHostCardHeight(host: HostInfo): number {
  let h = 46; // status row + base paddings
  if (host.hostname) h += 16;
  if (host.os) h += 14;
  if ((host.connectedIps?.length ?? 0) > 0) h += 14;
  if ((host.ports?.length ?? 0) > 0) h += 22;
  return Math.max(HOST_H, h);
}

function segmentSize(segment: SegmentData) {
  const hostCount = segment.hosts.length;
  const cols = Math.min(HOST_COLS_MAX, Math.max(1, hostCount));
  const hostHeights = segment.hosts.map((h) => estimateHostCardHeight(h));
  const w = Math.max(260, cols * HOST_W + (cols - 1) * HOST_GAP + SEG_PAD * 2);
  const headerH = estimateHeaderHeight(segment.name, w);
  const hostAreaHeight = hostHeights.length > 0
    ? hostHeights.reduce((sum, hh) => sum + hh, 0) + Math.max(0, hostHeights.length - 1) * HOST_GAP + SEG_PAD * 2
    : SEG_PAD;
  const h = headerH + hostAreaHeight;
  return { w, h, cols, headerH, hostHeights };
}

function hostPosition(index: number, cols: number, headerH: number, hostHeights: number[]) {
  const col = index % cols;
  const yOffset = hostHeights.slice(0, index).reduce((sum, hh) => sum + hh + HOST_GAP, 0);
  return {
    x: SEG_PAD + col * (HOST_W + HOST_GAP),
    y: headerH + SEG_PAD + yOffset,
  };
}

/* ─── Topology normalization ─── */

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let out = 0;
  for (const p of parts) {
    const v = Number.parseInt(p, 10);
    if (!Number.isInteger(v) || v < 0 || v > 255) return null;
    out = (out << 8) | v;
  }
  return out >>> 0;
}

function parseCidr(cidr: string): { network: number; prefix: number; mask: number } | null {
  const [networkIp, prefixRaw] = cidr.split("/");
  const prefix = Number.parseInt(prefixRaw ?? "", 10);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null;

  const network = ipv4ToInt(networkIp ?? "");
  if (network === null) return null;

  const mask = prefix === 0 ? 0 : ((~0 << (32 - prefix)) >>> 0);
  return { network: network & mask, prefix, mask };
}

function cidrContains(parentCidr: string, childCidr: string): boolean {
  const parent = parseCidr(parentCidr);
  const child = parseCidr(childCidr);
  if (!parent || !child) return false;
  if (parent.prefix > child.prefix) return false;
  return (child.network & parent.mask) === parent.network;
}

function isHostSubset(child: SegmentData, parent: SegmentData): boolean {
  if (child.hosts.length === 0) return false;
  const parentIps = new Set(parent.hosts.map((h) => h.ip));
  return child.hosts.every((h) => parentIps.has(h.ip));
}

function normalizeTopology(segments: SegmentData[], pivotRoutes: PivotRouteData[]) {
  const routeReferencedSegmentIds = new Set<string>();
  for (const route of pivotRoutes) {
    routeReferencedSegmentIds.add(route.fromSegmentId);
    routeReferencedSegmentIds.add(route.toSegmentId);
  }

  // Hide redundant nested segments used only as scan scopes.
  const redundantToParent = new Map<string, string>();
  for (const child of segments) {
    if (routeReferencedSegmentIds.has(child.id)) continue;
    if (child.scope !== "global") continue;
    if (!child.cidr || child.hosts.length === 0) continue;

    const childPrefix = parseCidr(child.cidr)?.prefix ?? 33;
    let bestParent: SegmentData | null = null;
    let bestPrefix = -1;

    for (const parent of segments) {
      if (parent.id === child.id) continue;
      if (parent.scope !== "global") continue;
      if (!parent.cidr) continue;
      if (!cidrContains(parent.cidr, child.cidr)) continue;
      if (!isHostSubset(child, parent)) continue;

      const prefix = parseCidr(parent.cidr)?.prefix ?? -1;
      if (prefix > bestPrefix && prefix < childPrefix) {
        bestParent = parent;
        bestPrefix = prefix;
      }
    }

    if (bestParent && bestParent.reachable === child.reachable) {
      redundantToParent.set(child.id, bestParent.id);
    }
  }

  const resolveSegmentId = (id: string) => {
    let cur = id;
    const visited = new Set<string>();
    while (redundantToParent.has(cur) && !visited.has(cur)) {
      visited.add(cur);
      cur = redundantToParent.get(cur)!;
    }
    return cur;
  };

  const visibleSegments = segments.filter((s) => !redundantToParent.has(s.id));
  const visibleSegmentIds = new Set(visibleSegments.map((s) => s.id));

  const dedupRouteKey = new Set<string>();
  const normalizedRoutes: PivotRouteData[] = [];

  for (const route of pivotRoutes) {
    const fromSegmentId = resolveSegmentId(route.fromSegmentId);
    const toSegmentId = resolveSegmentId(route.toSegmentId);
    if (!visibleSegmentIds.has(fromSegmentId) || !visibleSegmentIds.has(toSegmentId)) continue;
    if (fromSegmentId === toSegmentId) continue;

    const key = `${route.pivotHost.id}|${fromSegmentId}|${toSegmentId}|${route.protocol}|${route.port}|${route.status}`;
    if (dedupRouteKey.has(key)) continue;
    dedupRouteKey.add(key);

    normalizedRoutes.push({ ...route, fromSegmentId, toSegmentId });
  }

  return { segments: visibleSegments, pivotRoutes: normalizedRoutes };
}

/* ─── Custom Node: ME ─── */

function MeNode({ data }: { data: { vpnIp: string } }) {
  return (
    <div className="relative px-5 py-3 rounded-xl border-2 border-cyan-500 bg-cyan-500/10 backdrop-blur-sm shadow-lg shadow-cyan-500/20">
      <Handle type="source" position={Position.Right} className="!bg-cyan-500 !w-3 !h-3 !border-2 !border-cyan-300" />
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 rounded-full bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center">
          <User className="h-5 w-5 text-cyan-400" />
        </div>
        <div>
          <div className="font-bold text-sm text-cyan-300 tracking-wide">ME</div>
          {data.vpnIp ? (
            <div className="font-mono text-xs text-cyan-400/70">{data.vpnIp}</div>
          ) : (
            <div className="text-[10px] text-cyan-400/40">VPN not connected</div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Custom Node: Segment Group ─── */

function SegmentGroupNode({ data }: { data: { label: string; cidr: string; scope: string; ownerHostLabel: string; reachable: boolean; hostCount: number; reportCount: number; reportBugBountyCount: number; reportRiskCount: number; w: number; h: number } }) {
  const border = data.reachable ? "border-green-500/60" : "border-zinc-600/60";
  const headerBorder = data.reachable ? "border-green-500/20" : "border-zinc-700/40";
  const bg = data.reachable ? "bg-green-500/[0.03]" : "bg-zinc-800/30";
  const bugCount = Number(data.reportBugBountyCount ?? 0) || 0;
  const riskCount = Number(data.reportRiskCount ?? 0) || 0;
  const totalCount = Number(data.reportCount ?? 0) || 0;

  return (
    <div className={`rounded-xl border-2 ${border} ${bg} backdrop-blur-sm`} style={{ width: data.w, height: data.h }}>
      <Handle type="target" position={Position.Left} className="!bg-zinc-400 !w-3 !h-3 !border-2 !border-zinc-600" />
      <Handle type="source" position={Position.Right} className="!bg-zinc-400 !w-3 !h-3 !border-2 !border-zinc-600" />

      <div className={`flex items-start justify-between gap-2 px-3 py-2 border-b ${headerBorder}`}>
        <div className="flex items-start gap-2 min-w-0">
          <Network className="h-4 w-4 text-zinc-400 flex-shrink-0 mt-0.5" />
          <div className="min-w-0">
            <div className="font-bold text-sm leading-tight">{data.label}</div>
            {data.cidr && <div className="font-mono text-[10px] text-zinc-500 mt-0.5">{data.cidr}</div>}
            <div className="mt-1 flex items-center gap-1.5 text-[9px]">
              <span className={`px-1 rounded ${data.scope === "host-local" ? "bg-amber-500/20 text-amber-300" : "bg-zinc-700/70 text-zinc-300"}`}>
                {data.scope}
              </span>
              {data.scope === "host-local" && (
                <span className="font-mono text-zinc-500 truncate">{data.ownerHostLabel}</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {bugCount > 0 && <span className="text-[10px] font-mono text-lime-300">B:{bugCount}</span>}
          {riskCount > 0 && <span className="text-[10px] font-mono text-sky-400">R:{riskCount}</span>}
          {totalCount > 0 && <span className="text-[10px] font-mono text-zinc-400">T:{totalCount}</span>}
          {data.reachable
            ? <Wifi className="h-3.5 w-3.5 text-green-400" />
            : <WifiOff className="h-3.5 w-3.5 text-zinc-600" />
          }
        </div>
      </div>
    </div>
  );
}

/* ─── Custom Node: Host Card ─── */

const PORT_SHOW_MAX = 5;

function HostCardNode({ data }: { data: HostInfo }) {
  const [showPopover, setShowPopover] = useState(false);
  const statusColor = data.status === "up" ? "bg-green-400" : "bg-zinc-600";
  const borderColor = data.isDc ? "border-yellow-500/50" : "border-zinc-700/60";
  const displayIp = data.segmentIp || data.ip;
  const bugCount = Number(data.reportBugBountyCount ?? 0) || 0;
  const riskCount = Number(data.reportRiskCount ?? 0) || 0;
  const totalCount = Number(data.reportCount ?? 0) || 0;
  const ports = data.ports ?? [];
  const connectedIps = data.connectedIps ?? [];
  const visiblePorts = ports.slice(0, PORT_SHOW_MAX);
  const extraCount = ports.length - PORT_SHOW_MAX;

  return (
    <div
      className={`rounded-lg border ${borderColor} bg-zinc-900/80 backdrop-blur-sm px-3 py-2 hover:bg-zinc-800/80 transition-colors cursor-default relative`}
      style={{ width: HOST_W, minHeight: data.uiHeight ?? HOST_H }}
    >
      <Handle type="source" position={Position.Right} className="!bg-blue-500 !w-2 !h-2 !border !border-blue-300 !opacity-0 hover:!opacity-100" />
      <Handle type="target" position={Position.Left} className="!bg-blue-500 !w-2 !h-2 !border !border-blue-300 !opacity-0 hover:!opacity-100" />
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-1.5">
          <div className={`h-2 w-2 rounded-full ${statusColor} flex-shrink-0`} />
          <span className="font-mono text-sm font-bold leading-tight">{displayIp}</span>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {data.isDc && <Badge className="bg-yellow-600/80 text-[8px] px-1 py-0 h-3.5 leading-none">DC</Badge>}
          {bugCount > 0 && (
            <Badge className="text-[8px] px-1 py-0 h-3.5 leading-none bg-lime-600/80">
              B:{bugCount}
            </Badge>
          )}
          {riskCount > 0 && (
            <Badge className="text-[8px] px-1 py-0 h-3.5 leading-none bg-sky-600/80">
              R:{riskCount}
            </Badge>
          )}
          {totalCount > 0 && (
            <Badge className="text-[8px] px-1 py-0 h-3.5 leading-none bg-zinc-600/80">
              T:{totalCount}
            </Badge>
          )}
        </div>
      </div>

      <div className="mt-1 space-y-0.5">
        {data.hostname && (
          <div className="text-[11px] text-zinc-400 truncate">{data.hostname}</div>
        )}
        <div className="flex items-center justify-between">
          {data.os ? (
            <span className="text-[10px] text-zinc-500 truncate">{data.os}</span>
          ) : (
            <span />
          )}
        </div>
        {connectedIps.length > 0 && (
          <div className="flex items-center gap-1 text-[9px] text-cyan-400 truncate">
            <span className="text-zinc-500">route</span>
            <span className="font-mono truncate">
              {connectedIps.slice(0, 2).join(", ")}
              {connectedIps.length > 2 ? ` +${connectedIps.length - 2}` : ""}
            </span>
          </div>
        )}
      </div>

      {/* Port badges */}
      {ports.length > 0 && (
        <div
          className="mt-1 flex flex-wrap gap-0.5 items-center"
          onMouseEnter={() => ports.length > PORT_SHOW_MAX && setShowPopover(true)}
          onMouseLeave={() => setShowPopover(false)}
          onClick={() => setShowPopover((v) => !v)}
        >
          {visiblePorts.map((p) => (
            <span
              key={p.port}
              className="font-mono text-[9px] px-1 py-0 rounded bg-zinc-700/60 text-zinc-300 leading-tight"
              title={p.service || `port ${p.port}`}
            >
              {p.port}
            </span>
          ))}
          {extraCount > 0 && (
            <span className="font-mono text-[9px] px-1 py-0 rounded bg-zinc-600/40 text-zinc-400 leading-tight cursor-pointer">
              +{extraCount}
            </span>
          )}
        </div>
      )}

      {/* Popover with all ports */}
      {showPopover && ports.length > PORT_SHOW_MAX && (
        <div
          className="absolute left-0 top-full mt-1 z-50 bg-zinc-900 border border-zinc-600 rounded-lg p-2 shadow-xl min-w-[180px] max-w-[260px]"
          onMouseEnter={() => setShowPopover(true)}
          onMouseLeave={() => setShowPopover(false)}
        >
          <div className="text-[10px] text-zinc-400 font-bold mb-1">{ports.length} open ports</div>
          <div className="flex flex-wrap gap-1">
            {ports.map((p) => (
              <span key={p.port} className="font-mono text-[9px] px-1.5 py-0.5 rounded bg-zinc-700/80 text-zinc-300">
                {p.port}{p.service ? `/${p.service}` : ""}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const nodeTypes = {
  me: MeNode,
  segmentGroup: SegmentGroupNode,
  hostCard: HostCardNode,
};

/* ─── Build graph ─── */

function buildGraph(segments: SegmentData[], pivotRoutes: PivotRouteData[], vpnIp: string) {
  const normalized = normalizeTopology(segments, pivotRoutes);
  const visibleSegments = normalized.segments;
  const visiblePivotRoutes = normalized.pivotRoutes;

  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // ME node
  nodes.push({
    id: "me",
    type: "me",
    position: { x: 0, y: 0 },
    data: { vpnIp },
    draggable: false,
  });

  // ── Compute segment depth via BFS on pivot routes ──
  // depth 1 = root segments (reachable AND not a pivot target from another reachable)
  // depth 2+ = reached via pivot chain
  const pivotAdj = new Map<string, string[]>();
  const pivotTargets = new Set<string>();
  for (const route of visiblePivotRoutes.filter((r) => r.status === "active")) {
    const arr = pivotAdj.get(route.fromSegmentId) ?? [];
    arr.push(route.toSegmentId);
    pivotAdj.set(route.fromSegmentId, arr);
    pivotTargets.add(route.toSegmentId);
  }

  const depthMap = new Map<string, number>();
  const queue: string[] = [];

  // Seed: reachable segments that are NOT the target of any pivot route
  // (these are the true "entry point" segments like DMZ)
  for (const seg of visibleSegments) {
    if (seg.reachable && !pivotTargets.has(seg.id)) {
      depthMap.set(seg.id, 1);
      queue.push(seg.id);
    }
  }

  // BFS through pivot routes to assign increasing depth
  while (queue.length > 0) {
    const segId = queue.shift()!;
    const depth = depthMap.get(segId)!;
    for (const nId of (pivotAdj.get(segId) ?? [])) {
      if (!depthMap.has(nId)) {
        depthMap.set(nId, depth + 1);
        queue.push(nId);
      }
    }
  }

  // Fallback: reachable segments not placed yet (no pivot path but marked reachable)
  for (const seg of visibleSegments) {
    if (seg.reachable && !depthMap.has(seg.id)) {
      depthMap.set(seg.id, 1);
    }
  }

  // Group segments by depth (unreachable segments without pivot path → depth 999)
  const depthGroups = new Map<number, SegmentData[]>();
  for (const seg of visibleSegments) {
    const d = depthMap.get(seg.id) ?? 999;
    const group = depthGroups.get(d) ?? [];
    group.push(seg);
    depthGroups.set(d, group);
  }
  const sortedDepths = Array.from(depthGroups.keys()).sort((a, b) => a - b);

  const hostNodeBySegmentHost = new Map<string, string>();
  const hostNodeByHost = new Map<string, string>();

  const COL_GAP = 140;
  const SEG_GAP = 50;
  // Layout a column of segments, returns max width of the column
  function layoutColumn(segs: SegmentData[], xBase: number): number {
    const sizes = segs.map((s) => segmentSize(s));
    const totalH = sizes.reduce((sum, sz) => sum + sz.h, 0) + (segs.length - 1) * SEG_GAP;
    let y = -totalH / 2;
    let maxW = 0;

    segs.forEach((seg, i) => {
      const sz = sizes[i];
      if (sz.w > maxW) maxW = sz.w;
      const isReachable = depthMap.has(seg.id);

      nodes.push({
        id: seg.id,
        type: "segmentGroup",
        position: { x: xBase, y },
        data: {
          label: seg.name,
          cidr: seg.cidr,
          scope: seg.scope ?? "global",
          ownerHostLabel: seg.ownerHost?.ip ?? "unknown-host",
          reachable: isReachable,
          hostCount: seg.hostCount,
          reportCount: seg.reportCount,
          reportBugBountyCount: seg.reportBugBountyCount,
          reportRiskCount: seg.reportRiskCount,
          w: sz.w,
          h: sz.h,
        },
        draggable: false,
        style: { width: sz.w, height: sz.h },
      });

      seg.hosts.forEach((host, hi) => {
        const pos = hostPosition(hi, sz.cols, sz.headerH, sz.hostHeights);
        const hostNodeId = `${seg.id}::${host.id}`;
        hostNodeBySegmentHost.set(`${seg.id}::${host.id}`, hostNodeId);
        if (!hostNodeByHost.has(host.id)) hostNodeByHost.set(host.id, hostNodeId);

        nodes.push({
          id: hostNodeId,
          type: "hostCard",
          position: pos,
          parentId: seg.id,
          extent: "parent" as const,
          draggable: false,
          data: { ...host, uiHeight: sz.hostHeights[hi] },
        });
      });

      // Edge from ME to depth-1 (directly reachable) segments
      if (depthMap.get(seg.id) === 1) {
        edges.push({
          id: `me-${seg.id}`,
          source: "me",
          target: seg.id,
          type: "smoothstep",
          animated: true,
          style: { stroke: "#22c55e", strokeWidth: 2 },
          markerEnd: { type: MarkerType.ArrowClosed, color: "#22c55e", width: 14, height: 14 },
          label: "VPN",
          labelStyle: { fill: "#22c55e", fontSize: 10, fontFamily: "monospace" },
          labelBgStyle: { fill: "#09090b", fillOpacity: 0.9 },
          labelBgPadding: [4, 2] as [number, number],
        });
      }

      y += sz.h + SEG_GAP;
    });

    return maxW;
  }

  // Place each depth level as a column, left → right
  const meNodeWidth = 160;
  let curX = meNodeWidth + COL_GAP;

  for (const depth of sortedDepths) {
    const segs = depthGroups.get(depth)!;
    const colW = layoutColumn(segs, curX);
    curX += colW + COL_GAP;
  }

  // ── Pivot route edges ──
  // Connect pivot host → target segment (cleaner than host→every-host)
  const visibleSegmentIds = new Set(visibleSegments.map((s) => s.id));
  visiblePivotRoutes.forEach((route) => {
    if (!visibleSegmentIds.has(route.toSegmentId)) return;

    const sourceNodeId =
      hostNodeBySegmentHost.get(`${route.fromSegmentId}::${route.pivotHost.id}`) ??
      hostNodeByHost.get(route.pivotHost.id);
    if (!sourceNodeId) return;

    const statusColor = route.status === "active" ? "#3b82f6" : route.status === "inactive" ? "#6b7280" : "#eab308";

    edges.push({
      id: route.id,
      source: sourceNodeId,
      target: route.toSegmentId,
      type: "smoothstep",
      animated: route.status === "active",
      style: { stroke: statusColor, strokeWidth: 2, strokeDasharray: route.status === "active" ? undefined : "5 5" },
      markerEnd: { type: MarkerType.ArrowClosed, color: statusColor, width: 14, height: 14 },
      label: `${route.protocol}:${route.port}`,
      labelStyle: { fill: statusColor, fontSize: 9, fontFamily: "monospace" },
      labelBgStyle: { fill: "#09090b", fillOpacity: 0.9 },
      labelBgPadding: [4, 2] as [number, number],
    });
  });

  // ── Host route edges ──
  // Dashed edges inferred from host-level routing table data.
  const pivotTargetByHost = new Set(visiblePivotRoutes.map((route) => `${route.pivotHost.id}|${route.toSegmentId}`));
  const routeEdgeDedup = new Set<string>();
  const hostLocalSegments = visibleSegments.filter((segment) => segment.scope === "host-local");
  for (const fromSegment of visibleSegments) {
    if (fromSegment.scope === "host-local") continue;
    for (const host of fromSegment.hosts) {
      const sourceNodeId =
        hostNodeBySegmentHost.get(`${fromSegment.id}::${host.id}`) ??
        hostNodeByHost.get(host.id);
      if (!sourceNodeId) continue;

      for (const route of host.routes ?? []) {
        const destination = route.destination;
        if (!destination || destination === "0.0.0.0/0") continue;
        const isHostLocalRoute = isLikelyHostLocalInterface(route.iface);
        if (isHostLocalRoute) continue;

        for (const targetSegment of visibleSegments) {
          if (targetSegment.id === fromSegment.id) continue;
          if (!targetSegment.cidr) continue;
          if (targetSegment.scope === "host-local") continue;
          const overlaps =
            cidrContains(destination, targetSegment.cidr) ||
            cidrContains(targetSegment.cidr, destination);
          if (!overlaps) continue;
          if (pivotTargetByHost.has(`${host.id}|${targetSegment.id}`)) continue;

          const dedupKey = [
            host.id,
            targetSegment.id,
            destination,
            route.gateway,
            route.iface,
          ].join("|");
          if (routeEdgeDedup.has(dedupKey)) continue;
          routeEdgeDedup.add(dedupKey);

          const labelRaw = route.gateway ? `${destination} via ${route.gateway}` : destination;
          const label = labelRaw.length > 26 ? `${labelRaw.slice(0, 23)}...` : labelRaw;
          const edgeId = `route-${host.id}-${targetSegment.id}-${routeEdgeDedup.size}`;
          edges.push({
            id: edgeId,
            source: sourceNodeId,
            target: targetSegment.id,
            type: "smoothstep",
            animated: false,
            style: { stroke: "#06b6d4", strokeWidth: 1.5, strokeDasharray: "4 4" },
            markerEnd: { type: MarkerType.ArrowClosed, color: "#06b6d4", width: 12, height: 12 },
            label,
            labelStyle: { fill: "#22d3ee", fontSize: 8, fontFamily: "monospace" },
            labelBgStyle: { fill: "#09090b", fillOpacity: 0.9 },
            labelBgPadding: [3, 1] as [number, number],
          });
        }
      }
    }
  }

  // ── Host-local ownership edges ──
  // Keep local segments visually connected without full route spaghetti.
  for (const localSegment of hostLocalSegments) {
    const ownerHostId = localSegment.ownerHost?.id;
    if (!ownerHostId) continue;

    const sourceNodeId = hostNodeByHost.get(ownerHostId);
    if (!sourceNodeId) continue;

    edges.push({
      id: `owner-local-${ownerHostId}-${localSegment.id}`,
      source: sourceNodeId,
      target: localSegment.id,
      type: "smoothstep",
      animated: false,
      style: { stroke: "#64748b", strokeWidth: 1.2, strokeDasharray: "3 5" },
      markerEnd: { type: MarkerType.ArrowClosed, color: "#64748b", width: 10, height: 10 },
    });
  }

  return { nodes, edges };
}

/* ─── Stat Pill ─── */

function StatPill({ icon, label, value, color }: {
  icon: React.ReactNode; label: string; value: string | number; color?: string;
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-800/60 border border-zinc-700/50">
      {icon}
      <span className="text-xs text-zinc-400">{label}</span>
      <span className={`text-sm font-bold font-mono ${color ?? "text-zinc-100"}`}>{value}</span>
    </div>
  );
}

/* ─── Main ─── */

/* ─── Host Detail Panel ─── */

function HostDetailPanel({ host, onClose }: { host: HostInfo; onClose: () => void }) {
  const displayIp = host.segmentIp || host.ip;
  const ports = (host.ports ?? []).sort((a, b) => a.port - b.port);
  const routes = (host.routes ?? []).sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    return a.destination.localeCompare(b.destination);
  });
  const connectedIps = host.connectedIps ?? [];

  return (
    <div className="w-80 border-l border-zinc-800 bg-zinc-950 flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
        <div>
          <div className="font-mono text-sm font-bold">{displayIp}</div>
          {host.segmentIp && host.segmentIp !== host.ip && (
            <div className="font-mono text-[10px] text-zinc-500">host {host.ip}</div>
          )}
          {host.hostname && <div className="text-xs text-zinc-400">{host.hostname}</div>}
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Host info */}
      <div className="px-4 py-2 border-b border-zinc-800 space-y-1">
        <div className="flex items-center gap-2">
          <div className={`h-2 w-2 rounded-full ${host.status === "up" ? "bg-green-400" : "bg-zinc-600"}`} />
          <span className="text-xs text-zinc-400">{host.status}</span>
          {host.isDc && <Badge className="bg-yellow-600/80 text-[8px] px-1 py-0 h-3.5">DC</Badge>}
        </div>
        {host.os && <div className="text-xs text-zinc-500">{host.os}</div>}
        {connectedIps.length > 0 && (
          <div className="text-[10px] text-cyan-400 font-mono truncate">
            {connectedIps.join(", ")}
          </div>
        )}
      </div>

      {/* Ports */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-4 py-2">
          <div className="text-xs font-bold text-zinc-400 mb-2">{ports.length} Open Ports</div>
          <div className="space-y-1">
            {ports.map((p) => (
              <div key={p.port} className="flex items-start gap-2 py-1 border-b border-zinc-800/50 last:border-0">
                <span className="font-mono text-xs font-bold text-zinc-200 w-14 text-right flex-shrink-0">
                  {p.port}<span className="text-zinc-600">/{p.protocol || "tcp"}</span>
                </span>
                <div className="min-w-0">
                  <div className="text-xs text-yellow-400">{p.service || "unknown"}</div>
                  {p.version && <div className="text-[10px] text-zinc-500 truncate" title={p.version}>{p.version}</div>}
                </div>
              </div>
            ))}
            {ports.length === 0 && (
              <div className="text-xs text-zinc-600 text-center py-4">No open ports</div>
            )}
          </div>
        </div>

        <div className="px-4 py-2 border-t border-zinc-800">
          <div className="text-xs font-bold text-zinc-400 mb-2">{routes.length} Routes</div>
          <div className="space-y-1">
            {routes.map((route) => (
              <div key={route.id} className="py-1 border-b border-zinc-800/50 last:border-0">
                <div className="font-mono text-[11px] text-zinc-200 truncate">{route.destination}</div>
                <div className="text-[10px] text-zinc-500 truncate">
                  {route.gateway ? `via ${route.gateway}` : "direct"}{route.iface ? ` dev ${route.iface}` : ""}
                </div>
              </div>
            ))}
            {routes.length === 0 && (
              <div className="text-xs text-zinc-600 text-center py-2">No route data</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Main ─── */

function BattleMapClientImpl({ initialData }: { initialData: DashboardData }) {
  const [data, setData] = useState<DashboardData>(() => mergeDashboardData(initialData, initialData));
  const [selectedHost, setSelectedHost] = useState<HostInfo | null>(null);

  const refresh = useCallback(async () => {
    try {
      const fresh = await apiGet<DashboardData>("/api/dashboard");
      setData((prev) => mergeDashboardData(prev, fresh));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    const id = setInterval(refresh, 10000);
    return () => clearInterval(id);
  }, [refresh]);

  const { vpnIp, stats, segments, pivotRoutes, credentialSummary } = data;
  const reportTypeTotals = stats.reportTypeTotals ?? { bugBounty: 0, risk: 0 };

  const handleNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    if (node.type === "hostCard") {
      const host = node.data as HostInfo | undefined;
      if (host?.id) setSelectedHost(host);
    }
  }, []);

  const graph = useMemo(() => buildGraph(segments, pivotRoutes, vpnIp), [segments, pivotRoutes, vpnIp]);
  const [graphNodes, setNodes, onNodesChange] = useNodesState(graph.nodes);
  const [graphEdges, setEdges, onEdgesChange] = useEdgesState(graph.edges);

  useEffect(() => {
    const g = buildGraph(segments, pivotRoutes, vpnIp);
    // Always apply the computed layout for top-level nodes so segment groups
    // stay collision-free as sizes and depth columns change.
    setNodes(g.nodes);
    setEdges(g.edges);
  }, [segments, pivotRoutes, vpnIp, setNodes, setEdges]);

  return (
    <div className="flex flex-col h-[calc(100vh-64px)]">
      {/* Stats Bar */}
      <div className="flex items-center gap-3 px-2 py-2 flex-wrap border-b border-zinc-800">
        <StatPill icon={<Monitor className="h-3.5 w-3.5 text-blue-400" />} label="Hosts" value={stats.totalHosts} />
        <StatPill icon={<KeyRound className="h-3.5 w-3.5 text-yellow-400" />} label="Creds" value={credentialSummary.total} />
        <StatPill icon={<Shield className="h-3.5 w-3.5 text-red-400" />} label="Admin" value={credentialSummary.admin} color="text-red-400" />
        <StatPill icon={<FileText className="h-3.5 w-3.5 text-cyan-400" />} label="Reports" value={stats.totalReports} />
        <StatPill icon={<FileText className="h-3.5 w-3.5 text-lime-300" />} label="Bug Bounty" value={reportTypeTotals.bugBounty ?? 0} color="text-lime-300" />
        <StatPill icon={<FileText className="h-3.5 w-3.5 text-sky-400" />} label="Risk" value={reportTypeTotals.risk ?? 0} color="text-sky-400" />
        <StatPill icon={<FileText className="h-3.5 w-3.5 text-orange-400" />} label="Pending Reports" value={stats.pendingReports} color="text-orange-400" />
      </div>

      {/* Flow Canvas + Side Panel */}
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 relative">
          <ReactFlow
            nodes={graphNodes}
            edges={graphEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={handleNodeClick}
            onPaneClick={() => setSelectedHost(null)}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.6, maxZoom: 0.85 }}
            minZoom={0.2}
            maxZoom={2.5}
            proOptions={{ hideAttribution: true }}
            colorMode="dark"
            nodesDraggable
            elementsSelectable
            selectNodesOnDrag={false}
          >
            <Background gap={20} size={1} color="#27272a" />
            <Controls
              showInteractive={false}
              className="!bg-zinc-800 !border-zinc-700 !rounded-lg !shadow-lg [&>button]:!bg-zinc-800 [&>button]:!border-zinc-700 [&>button]:!text-zinc-400 [&>button:hover]:!bg-zinc-700"
            />
          </ReactFlow>
        </div>

        {/* Host Detail Side Panel */}
        {selectedHost && (
          <HostDetailPanel host={selectedHost} onClose={() => setSelectedHost(null)} />
        )}
      </div>
    </div>
  );
}

/* SSR completely disabled — React Flow causes hydration mismatches */
export const BattleMapClient = dynamic(
  () => Promise.resolve({ default: BattleMapClientImpl }),
  {
    ssr: false,
    loading: () => (
      <div className="flex flex-col h-[calc(100vh-64px)]">
        <div className="flex-1 flex items-center justify-center text-zinc-600 text-sm">Loading map...</div>
      </div>
    ),
  },
);
