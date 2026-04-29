import { prisma } from "@/lib/prisma";
import type { ImportResult, ProtocolDetectData } from "../types";

type ServiceEntry = NonNullable<ProtocolDetectData["services"]>[number];

function protocolToDeviceType(protocol: string): string {
  switch (protocol) {
    case "modbus":
    case "s7comm":
    case "enip":
      return "plc";
    case "opcua":
    case "opcua-tls":
      return "opcua-server";
    case "mqtt":
    case "mqtt-tls":
      return "broker";
    case "dnp3":
    case "iec104":
      return "rtu";
    case "bacnet":
      return "bms-device";
    case "http":
    case "https":
    case "http-alt":
      return "hmi";
    case "mssql":
    case "mysql":
    case "postgresql":
      return "historian-db";
    default:
      return "unknown";
  }
}

function normalizeProtocol(raw: unknown): string {
  if (typeof raw !== "string") return "unknown";
  const value = raw.trim().toLowerCase();
  if (!value) return "unknown";
  return value.replace(/[^a-z0-9_-]/g, "");
}

function toPort(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isInteger(raw) && raw > 0 && raw <= 65535) return raw;
  if (typeof raw === "string") {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) return parsed;
  }
  return null;
}

function buildDescription(svc: ServiceEntry): string {
  const parts = [
    typeof svc.description === "string" ? svc.description : "",
    typeof svc.template === "string" ? `template=${svc.template}` : "",
    svc.modbus_confirmed ? "modbus_confirmed=true" : "",
  ].filter(Boolean);
  return parts.join(" | ").slice(0, 500);
}

export async function importProtocolDetect(data: ProtocolDetectData): Promise<ImportResult> {
  const result: ImportResult = { format: "protocol-detect", created: {}, updated: {}, errors: [] };
  let devicesCreated = 0;
  let registersCreated = 0;

  if (!data.host || typeof data.host !== "string") {
    result.errors.push("host field is required for protocol-detect import");
    return result;
  }

  const services = Array.isArray(data.services) ? data.services : [];
  if (services.length === 0) {
    result.errors.push("services array is empty");
    return result;
  }

  for (const svc of services) {
    try {
      const port = toPort(svc.port);
      if (port === null) {
        result.errors.push(`Service on ${data.host}: invalid port`);
        continue;
      }

      const protocol = normalizeProtocol(svc.protocol);
      const description = buildDescription(svc);
      const bannerAscii = typeof svc.banner_ascii === "string" ? svc.banner_ascii.slice(0, 1000) : "";
      const bannerHex = typeof svc.banner_hex === "string" ? svc.banner_hex.slice(0, 1000) : "";
      const where = { host_port_unitId: { host: data.host, port, unitId: 1 } };
      const existing = await prisma.scadaDevice.findUnique({ where });
      const effectiveProtocol = protocol === "unknown" && existing ? existing.protocol : protocol;
      const effectiveDescription = description || existing?.description || "";

      const device = await prisma.scadaDevice.upsert({
        where,
        update: {
          protocol: effectiveProtocol,
          deviceType: protocolToDeviceType(effectiveProtocol),
          description: effectiveDescription,
          scanTime: new Date(),
        },
        create: {
          host: data.host,
          port,
          unitId: 1,
          protocol: effectiveProtocol,
          deviceType: protocolToDeviceType(effectiveProtocol),
          description: effectiveDescription,
        },
      });
      devicesCreated += 1;

      const decodedValue = [effectiveProtocol, effectiveDescription, bannerAscii].filter(Boolean).join(" | ");
      const isNonZero = Boolean(svc.open ?? true);

      await prisma.scadaRegister.upsert({
        where: {
          deviceId_registerType_address: {
            deviceId: device.id,
            registerType: "service",
            address: port,
          },
        },
        update: {
          rawValue: isNonZero ? 1 : 0,
          decodedValue: decodedValue.slice(0, 4000),
          hexValue: bannerHex,
          isNonZero,
          lastUpdated: new Date(),
        },
        create: {
          deviceId: device.id,
          registerType: "service",
          address: port,
          rawValue: isNonZero ? 1 : 0,
          decodedValue: decodedValue.slice(0, 4000),
          hexValue: bannerHex,
          isNonZero,
        },
      });
      registersCreated += 1;
    } catch (e) {
      result.errors.push(`Service ${data.host}: ${e instanceof Error ? e.message : "unknown error"}`);
    }
  }

  result.created = { devices: devicesCreated, registers: registersCreated };
  return result;
}
