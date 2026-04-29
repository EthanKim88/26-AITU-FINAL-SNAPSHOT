import { prisma } from "@/lib/prisma";
import { syncHostLocalSegmentsFromRoutes } from "@/lib/segment-utils";

export interface HostRouteInput {
  destination: string;
  gateway?: string;
  iface?: string;
  srcIp?: string;
  connectedIp?: string;
  metric?: number | null;
  isDefault?: boolean;
  isConnected?: boolean;
  source?: string;
  raw?: string;
  notes?: string;
}

export interface HostRouteUpsertResult {
  created: number;
  updated: number;
  total: number;
  routes: Array<{
    id: string;
    hostId: string;
    destination: string;
    gateway: string;
    iface: string;
    srcIp: string;
    connectedIp: string;
    metric: number | null;
    isDefault: boolean;
    isConnected: boolean;
    source: string;
    raw: string;
    notes: string;
    createdAt: Date;
    updatedAt: Date;
  }>;
}

const ROUTE_TYPE_PREFIXES = new Set([
  "blackhole",
  "unreachable",
  "prohibit",
  "throw",
  "broadcast",
  "local",
  "anycast",
  "multicast",
  "nat",
]);

function normalizeText(value?: string | null): string {
  return value?.trim() ?? "";
}

function isIpv4(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    const value = Number.parseInt(part, 10);
    return value >= 0 && value <= 255;
  });
}

function ipv4ToNumber(ip: string): number | null {
  if (!isIpv4(ip)) return null;
  const parts = ip.split(".").map((p) => Number.parseInt(p, 10));
  let out = 0;
  for (const part of parts) out = (out << 8) | part;
  return out >>> 0;
}

function numberToIpv4(value: number): string {
  return [
    (value >>> 24) & 255,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255,
  ].join(".");
}

function normalizeDestination(raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  if (value === "default") return "0.0.0.0/0";
  if (value.includes("/")) {
    const [ip, prefixRaw] = value.split("/");
    const prefix = Number.parseInt(prefixRaw ?? "", 10);
    if (!isIpv4(ip) || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return value;
    const ipNum = ipv4ToNumber(ip);
    if (ipNum === null) return value;
    const mask = prefix === 0 ? 0 : ((~0 << (32 - prefix)) >>> 0);
    return `${numberToIpv4(ipNum & mask)}/${prefix}`;
  }
  if (isIpv4(value)) return `${value}/32`;
  return value;
}

function readTokenValue(tokens: string[], key: string): string {
  const index = tokens.findIndex((token) => token === key);
  if (index === -1 || index + 1 >= tokens.length) return "";
  return tokens[index + 1] ?? "";
}

function netmaskToPrefix(mask: string): number | null {
  const trimmed = mask.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("0x")) {
    const value = Number.parseInt(trimmed, 16);
    if (!Number.isFinite(value)) return null;
    const asBinary = value.toString(2).padStart(32, "0");
    if (!/^1*0*$/.test(asBinary)) return null;
    return [...asBinary].filter((c) => c === "1").length;
  }

  if (!isIpv4(trimmed)) return null;
  const bits = trimmed
    .split(".")
    .map((octet) => Number.parseInt(octet, 10).toString(2).padStart(8, "0"))
    .join("");
  if (!/^1*0*$/.test(bits)) return null;
  return [...bits].filter((c) => c === "1").length;
}

function cidrFromIp(ip: string, prefix: number): string {
  const ipNum = ipv4ToNumber(ip);
  if (ipNum === null || prefix < 0 || prefix > 32) return `${ip}/${prefix}`;
  const mask = prefix === 0 ? 0 : ((~0 << (32 - prefix)) >>> 0);
  return `${numberToIpv4(ipNum & mask)}/${prefix}`;
}

function toMetric(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeRouteInput(input: HostRouteInput, fallbackSource: string): HostRouteInput | null {
  const destination = normalizeDestination(input.destination);
  if (!destination) return null;

  const gateway = normalizeText(input.gateway);
  const iface = normalizeText(input.iface);
  const srcIp = normalizeText(input.srcIp);
  const connectedIp = normalizeText(input.connectedIp) || srcIp;
  const isDefault = input.isDefault ?? destination === "0.0.0.0/0";
  const isConnected = input.isConnected ?? (!gateway && destination !== "0.0.0.0/0");

  return {
    destination,
    gateway,
    iface,
    srcIp,
    connectedIp,
    metric: toMetric(input.metric),
    isDefault,
    isConnected,
    source: normalizeText(input.source) || fallbackSource,
    raw: normalizeText(input.raw),
    notes: normalizeText(input.notes),
  };
}

function dedupeRouteInputs(routes: HostRouteInput[]): HostRouteInput[] {
  const map = new Map<string, HostRouteInput>();
  for (const route of routes) {
    const key = [
      route.destination,
      route.gateway ?? "",
      route.iface ?? "",
      route.srcIp ?? "",
      route.connectedIp ?? "",
    ].join("|");
    map.set(key, route);
  }
  return [...map.values()];
}

export function parseIpRouteOutput(output: string, source = "ip-route"): HostRouteInput[] {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const parsed: HostRouteInput[] = [];

  for (const line of lines) {
    const tokens = line.split(/\s+/);
    if (tokens.length === 0) continue;

    let destinationToken = tokens[0] ?? "";
    let routeType = "";
    if (destinationToken !== "default" && ROUTE_TYPE_PREFIXES.has(destinationToken)) {
      routeType = destinationToken;
      destinationToken = tokens[1] ?? "";
    }
    if (!destinationToken) continue;

    const destination = normalizeDestination(destinationToken);
    if (!destination) continue;

    const gateway = normalizeText(readTokenValue(tokens, "via"));
    const iface = normalizeText(readTokenValue(tokens, "dev"));
    const srcIp = normalizeText(readTokenValue(tokens, "src"));
    const metric = toMetric(readTokenValue(tokens, "metric"));

    const notes = routeType && routeType !== "default" ? `routeType=${routeType}` : "";

    parsed.push({
      destination,
      gateway,
      iface,
      srcIp,
      connectedIp: srcIp,
      metric,
      isDefault: destination === "0.0.0.0/0",
      isConnected: line.includes("scope link") || (!gateway && destination !== "0.0.0.0/0"),
      source,
      raw: line,
      notes,
    });
  }

  return dedupeRouteInputs(parsed);
}

export function parseIpAddrOutput(output: string, source = "ip-addr"): HostRouteInput[] {
  const lines = output.split(/\r?\n/);
  const parsed: HostRouteInput[] = [];
  let currentIface = "";

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const ipRouteLinkMatch = line.match(/^\d+:\s+([^\s:@]+)(?:@[^\s:]+)?\s/);
    if (ipRouteLinkMatch) {
      currentIface = ipRouteLinkMatch[1] ?? "";
    }

    const ifconfigLinkMatch = line.match(/^([A-Za-z0-9_.:-]+):\s+[A-Za-z_]+=/);
    if (ifconfigLinkMatch) {
      currentIface = ifconfigLinkMatch[1] ?? "";
      continue;
    }

    let ip = "";
    let prefix: number | null = null;

    const cidrMatch = line.match(/\binet\s+(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})\b/);
    if (cidrMatch) {
      ip = cidrMatch[1] ?? "";
      prefix = Number.parseInt(cidrMatch[2] ?? "", 10);
    } else {
      const ifconfigAddrMatch = line.match(/\binet\s+(\d{1,3}(?:\.\d{1,3}){3})\s+netmask\s+([0-9A-Fa-fx\.]+)/);
      if (ifconfigAddrMatch) {
        ip = ifconfigAddrMatch[1] ?? "";
        prefix = netmaskToPrefix(ifconfigAddrMatch[2] ?? "");
      }
    }

    if (!ip || !isIpv4(ip)) continue;
    if (ip.startsWith("127.")) continue;
    if (prefix === null || prefix < 0 || prefix > 32) continue;

    parsed.push({
      destination: cidrFromIp(ip, prefix),
      gateway: "",
      iface: currentIface,
      srcIp: ip,
      connectedIp: ip,
      metric: null,
      isDefault: false,
      isConnected: true,
      source,
      raw: line,
      notes: "",
    });
  }

  return dedupeRouteInputs(parsed);
}

export function extractHostRoutesFromOutputs(params: {
  ipRouteOutput?: string;
  ipAddrOutput?: string;
  source?: string;
}): HostRouteInput[] {
  const source = normalizeText(params.source) || "discovery";
  const routeEntries = params.ipRouteOutput ? parseIpRouteOutput(params.ipRouteOutput, `${source}:ip-route`) : [];
  const addrEntries = params.ipAddrOutput ? parseIpAddrOutput(params.ipAddrOutput, `${source}:ip-addr`) : [];

  const ifaceToIp = new Map<string, string>();
  for (const entry of addrEntries) {
    if (entry.iface && entry.connectedIp && !ifaceToIp.has(entry.iface)) {
      ifaceToIp.set(entry.iface, entry.connectedIp);
    }
  }

  const merged = [...routeEntries, ...addrEntries].map((entry) => {
    const connectedIp = entry.connectedIp || (entry.iface ? ifaceToIp.get(entry.iface) ?? "" : "") || entry.srcIp || "";
    return {
      ...entry,
      connectedIp,
      isConnected: entry.isConnected ?? (!!connectedIp && entry.destination !== "0.0.0.0/0"),
    };
  });

  const normalized = merged
    .map((entry) => normalizeRouteInput(entry, source))
    .filter((entry): entry is HostRouteInput => entry !== null);

  return dedupeRouteInputs(normalized);
}

export async function resolveHostId(input: { hostId?: string; hostIp?: string }): Promise<string | null> {
  if (input.hostId?.trim()) {
    const exists = await prisma.host.findUnique({
      where: { id: input.hostId.trim() },
      select: { id: true },
    });
    return exists?.id ?? null;
  }
  if (input.hostIp?.trim()) {
    const byIp = await prisma.host.findUnique({
      where: { ip: input.hostIp.trim() },
      select: { id: true },
    });
    return byIp?.id ?? null;
  }
  return null;
}

export async function upsertHostRoutes(params: {
  hostId: string;
  routes: HostRouteInput[];
  replace?: boolean;
  defaultSource?: string;
}): Promise<HostRouteUpsertResult> {
  const hostId = params.hostId.trim();
  const defaultSource = normalizeText(params.defaultSource) || "manual";
  const normalized = dedupeRouteInputs(
    params.routes
      .map((route) => normalizeRouteInput(route, defaultSource))
      .filter((route): route is HostRouteInput => route !== null),
  );

  if (normalized.length === 0) {
    if (params.replace) {
      await prisma.hostRoute.deleteMany({ where: { hostId } });
      return { created: 0, updated: 0, total: 0, routes: [] };
    }
    const current = await prisma.hostRoute.findMany({
      where: { hostId },
      orderBy: [{ isDefault: "desc" }, { destination: "asc" }, { iface: "asc" }],
    });
    return { created: 0, updated: 0, total: current.length, routes: current };
  }

  let created = 0;
  let updated = 0;

  await prisma.$transaction(async (tx) => {
    if (params.replace) {
      await tx.hostRoute.deleteMany({ where: { hostId } });
    }

    for (const route of normalized) {
      const where = {
        hostId_destination_gateway_iface_srcIp_connectedIp: {
          hostId,
          destination: route.destination,
          gateway: route.gateway ?? "",
          iface: route.iface ?? "",
          srcIp: route.srcIp ?? "",
          connectedIp: route.connectedIp ?? "",
        },
      };

      const existing = await tx.hostRoute.findUnique({
        where,
        select: { id: true },
      });

      await tx.hostRoute.upsert({
        where,
        create: {
          hostId,
          destination: route.destination,
          gateway: route.gateway ?? "",
          iface: route.iface ?? "",
          srcIp: route.srcIp ?? "",
          connectedIp: route.connectedIp ?? "",
          metric: route.metric ?? null,
          isDefault: route.isDefault ?? false,
          isConnected: route.isConnected ?? false,
          source: route.source ?? defaultSource,
          raw: route.raw ?? "",
          notes: route.notes ?? "",
        },
        update: {
          metric: route.metric ?? null,
          isDefault: route.isDefault ?? false,
          isConnected: route.isConnected ?? false,
          source: route.source ?? defaultSource,
          raw: route.raw ?? "",
          notes: route.notes ?? "",
        },
      });

      if (existing) updated++;
      else created++;
    }
  });

  const persisted = await prisma.hostRoute.findMany({
    where: { hostId },
    orderBy: [{ isDefault: "desc" }, { destination: "asc" }, { iface: "asc" }],
  });

  // Keep host-local segments in sync with fresh route/interface data.
  await syncHostLocalSegmentsFromRoutes(hostId);

  return {
    created,
    updated,
    total: persisted.length,
    routes: persisted,
  };
}
