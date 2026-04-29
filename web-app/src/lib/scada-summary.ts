import { prisma } from "@/lib/prisma";
import { ICS_PROTOCOLS } from "@/lib/ics-protocols";
import { sanitizeScadaText } from "@/lib/scada-sanitize";

type CounterMap = Record<string, number>;

function inc(map: CounterMap, key: string, amount = 1) {
  map[key] = (map[key] ?? 0) + amount;
}

function sortCountMap(map: CounterMap): CounterMap {
  return Object.fromEntries(
    Object.entries(map).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  );
}

export async function getScadaSummary() {
  const [devices, checklists] = await Promise.all([
    prisma.scadaDevice.findMany({
      include: {
        registers: { orderBy: [{ registerType: "asc" }, { address: "asc" }] },
        _count: { select: { registers: true } },
      },
      orderBy: [{ scanTime: "desc" }, { host: "asc" }, { port: "asc" }, { unitId: "asc" }],
    }),
    prisma.attackChecklist.findMany({
      where: {
        host: {
          ports: {
            some: {
              OR: [
                { port: 502 }, // Modbus TCP
                { port: 4840 }, // OPC UA
                { port: 102 }, // S7comm
                { port: 1883 }, // MQTT
                { port: 8883 }, // MQTT TLS
                { port: 44818 }, // ENIP
                { port: 47808 }, // BACnet
                { port: 20000 }, // DNP3
                { port: 2404 }, // IEC104
              ],
            },
          },
        },
      },
      include: {
        host: { select: { id: true, ip: true, hostname: true, os: true } },
        session: { select: { id: true, title: true, status: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const sanitizedDevices = devices.map((d) => {
    const registers = d.registers.map((r) => ({
      ...r,
      decodedValue: sanitizeScadaText(r.decodedValue),
      hexValue: sanitizeScadaText(r.hexValue),
    }));

    return {
      ...d,
      description: sanitizeScadaText(d.description),
      registers,
      _count: { registers: registers.length },
    };
  });

  const protocolCounts: CounterMap = {};
  const deviceTypeCounts: CounterMap = {};
  const registerTypeCounts: CounterMap = {};
  let registerCount = 0;
  let nonZeroCount = 0;

  for (const d of sanitizedDevices) {
    inc(protocolCounts, d.protocol || "modbus");
    inc(deviceTypeCounts, d.deviceType || "unknown");

    for (const r of d.registers) {
      registerCount += 1;
      if (r.isNonZero) nonZeroCount += 1;
      inc(registerTypeCounts, r.registerType);
    }
  }

  const protocolMetaByKey = new Map(ICS_PROTOCOLS.map((p) => [p.key, p]));
  const knownProtocols = ICS_PROTOCOLS.map((p) => ({
    key: p.key,
    name: p.name,
    port: p.port,
    category: p.category,
    toolGrade: p.grade,
    deviceCount: protocolCounts[p.key] ?? 0,
    hasLibrary: p.library.installed,
    libraryName: p.library.name,
    recommendedLibrary: p.library.recommended ?? "",
    hasTemplate: Boolean(p.template),
    template: p.template ?? "",
    hasNmap: Boolean(p.nmap),
    nmap: p.nmap ?? "",
  }));

  // Include runtime-discovered protocols that are not yet in static coverage table.
  const extraProtocols = Object.keys(protocolCounts)
    .filter((k) => !protocolMetaByKey.has(k))
    .map((k) => ({
      key: k,
      name: k.toUpperCase(),
      port: 0,
      category: "not-covered" as const,
      toolGrade: "D",
      deviceCount: protocolCounts[k] ?? 0,
      hasLibrary: false,
      libraryName: "",
      recommendedLibrary: "",
      hasTemplate: false,
      template: "",
      hasNmap: false,
      nmap: "",
    }));

  return {
    stats: {
      deviceCount: sanitizedDevices.length,
      registerCount,
      nonZeroCount,
      protocolCount: Object.keys(protocolCounts).length,
      hostCount: new Set(sanitizedDevices.map((d) => d.host)).size,
      protocolCounts: sortCountMap(protocolCounts),
      deviceTypeCounts: sortCountMap(deviceTypeCounts),
      registerTypeCounts: sortCountMap(registerTypeCounts),
    },
    devices: sanitizedDevices,
    protocols: [...knownProtocols, ...extraProtocols],
    checklists,
  };
}

// Backward-compatible alias
export const getIcsScadaSummary = getScadaSummary;
