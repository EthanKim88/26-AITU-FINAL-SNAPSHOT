import { prisma } from "@/lib/prisma";
import type { ImportResult, ScadaTemplateData } from "../types";

type RegisterCandidate = {
  registerType: string;
  address: number;
  rawValue: number;
  decodedValue?: string;
  hexValue?: string;
  isNonZero?: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function asInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function stringifyValue(value: unknown, maxLen = 4000): string {
  let str: string;
  if (typeof value === "string") str = value;
  else if (typeof value === "number" || typeof value === "boolean") str = String(value);
  else {
    try {
      str = JSON.stringify(value);
    } catch {
      str = "";
    }
  }
  return str.slice(0, maxLen);
}

function hexOf(value: number): string {
  return `0x${(value >>> 0).toString(16)}`;
}

function sanitizeProtocol(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const value = raw.trim().toLowerCase();
  return value.replace(/[^a-z0-9_-]/g, "");
}

function stableAddress(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash | 0) || 1;
}

function detectTemplateProtocol(data: ScadaTemplateData): string {
  const explicit = sanitizeProtocol(data.protocol);
  if (explicit) return explicit;
  if (data.units && isRecord(data.units)) return "modbus";
  if (Array.isArray(data.nodes) || Array.isArray(data.endpoints)) return "opcua";
  if (data.cpu_info || data.dbs) return "s7comm";
  if (Array.isArray(data.topics) || Array.isArray(data.messages_sample)) return "mqtt";
  if (data.identity || Array.isArray(data.tags)) return "enip";
  if (Array.isArray(data.active_addresses) || data.class0 || data.class123) return "dnp3";
  if (Array.isArray(data.data_points) || typeof data.response_count === "number") return "iec104";
  if (Array.isArray(data.who_is) || Array.isArray(data.objects)) return "bacnet";
  return "unknown";
}

function protocolToDefaultPort(protocol: string): number {
  switch (protocol) {
    case "modbus":
      return 502;
    case "opcua":
    case "opcua-tls":
      return 4840;
    case "s7comm":
      return 102;
    case "mqtt":
    case "mqtt-tls":
      return 1883;
    case "enip":
      return 44818;
    case "bacnet":
      return 47808;
    case "dnp3":
      return 20000;
    case "iec104":
      return 2404;
    default:
      return 0;
  }
}

function normalizePort(raw: unknown, fallback: number): number {
  const port = asInt(raw);
  if (port !== null && port > 0 && port <= 65535) return port;
  if (fallback > 0 && fallback <= 65535) return fallback;
  return 502;
}

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
    default:
      return "unknown";
  }
}

function dedupeRegisters(rows: RegisterCandidate[]): RegisterCandidate[] {
  const map = new Map<string, RegisterCandidate>();
  for (const row of rows) {
    const key = `${row.registerType}:${row.address}`;
    if (!map.has(key)) map.set(key, row);
  }
  return Array.from(map.values());
}

function modbusRegistersFromTemplate(data: ScadaTemplateData): Record<number, RegisterCandidate[]> {
  const units = isRecord(data.units) ? data.units : {};
  const output: Record<number, RegisterCandidate[]> = {};

  for (const [unitKey, rawUnit] of Object.entries(units)) {
    const unitId = asInt(unitKey) ?? 1;
    if (!isRecord(rawUnit)) continue;
    const rows: RegisterCandidate[] = [];
    const registers = isRecord(rawUnit.registers) ? rawUnit.registers : {};

    for (const [registerType, rawRegisters] of Object.entries(registers)) {
      if (!isRecord(rawRegisters)) continue;
      for (const [addressKey, rawValue] of Object.entries(rawRegisters)) {
        const address = asInt(addressKey);
        if (address === null) continue;
        const intValue = asInt(rawValue) ?? 0;
        const decodedValue = stringifyValue(rawValue, 500);
        rows.push({
          registerType,
          address,
          rawValue: intValue,
          decodedValue,
          hexValue: hexOf(intValue),
          isNonZero: intValue !== 0 || decodedValue.length > 0,
        });
      }
    }

    output[unitId] = dedupeRegisters(rows);
  }

  return output;
}

function genericRegistersFromTemplate(
  data: ScadaTemplateData,
  protocol: string
): RegisterCandidate[] {
  const rows: RegisterCandidate[] = [];

  if (protocol === "opcua") {
    const nodes = Array.isArray(data.nodes) ? data.nodes : [];
    nodes.forEach((row, idx) => {
      if (!isRecord(row)) return;
      const nodeId = asString(row.node_id) || `node-${idx}`;
      const name = asString(row.name);
      const value = stringifyValue(row.value, 500);
      const dtype = asString(row.type) || "unknown";
      const decodedValue = [name, value].filter(Boolean).join(" | ");
      const intValue = asInt(row.value) ?? (value.length > 0 ? value.length : 0);
      rows.push({
        registerType: `node:${dtype}`,
        address: stableAddress(nodeId),
        rawValue: intValue,
        decodedValue,
        hexValue: intValue !== 0 ? hexOf(intValue) : "",
        isNonZero: intValue !== 0 || decodedValue.length > 0,
      });
    });

    const endpoints = Array.isArray(data.endpoints) ? data.endpoints : [];
    endpoints.forEach((endpoint, idx) => {
      if (!isRecord(endpoint)) return;
      const url = asString(endpoint.url);
      const policy = asString(endpoint.security_policy);
      const mode = asString(endpoint.security_mode);
      const decodedValue = [url, mode, policy].filter(Boolean).join(" | ");
      rows.push({
        registerType: "endpoint",
        address: idx,
        rawValue: decodedValue.length,
        decodedValue,
        isNonZero: decodedValue.length > 0,
      });
    });
  } else if (protocol === "s7comm") {
    const cpuState = asString(data.cpu_state);
    if (cpuState) {
      rows.push({
        registerType: "cpu-state",
        address: 0,
        rawValue: cpuState.toLowerCase() === "run" ? 1 : 0,
        decodedValue: cpuState,
        isNonZero: true,
      });
    }

    const dbs = isRecord(data.dbs) ? data.dbs : {};
    for (const [dbKey, rawDb] of Object.entries(dbs)) {
      if (!isRecord(rawDb)) continue;
      const address = asInt(dbKey) ?? stableAddress(dbKey);
      const size = asInt(rawDb.size) ?? 0;
      const ascii = asString(rawDb.ascii).slice(0, 500);
      const hex = asString(rawDb.hex).slice(0, 1000);
      rows.push({
        registerType: "db",
        address,
        rawValue: size,
        decodedValue: ascii,
        hexValue: hex,
        isNonZero: size > 0 || ascii.length > 0,
      });
    }
  } else if (protocol === "mqtt" || protocol === "mqtt-tls") {
    const topics = Array.isArray(data.topics) ? data.topics : [];
    topics.forEach((topic, idx) => {
      const topicName = asString(topic);
      if (!topicName) return;
      rows.push({
        registerType: "topic",
        address: idx,
        rawValue: 1,
        decodedValue: topicName,
        isNonZero: true,
      });
    });

    const messages = Array.isArray(data.messages_sample) ? data.messages_sample : [];
    messages.forEach((msg, idx) => {
      if (!isRecord(msg)) return;
      const topic = asString(msg.topic);
      const payload = asString(msg.payload);
      const decodedValue = [topic, payload].filter(Boolean).join(": ");
      rows.push({
        registerType: "message",
        address: idx,
        rawValue: payload.length,
        decodedValue,
        isNonZero: payload.length > 0,
      });
    });
  } else if (protocol === "enip") {
    const values = Array.isArray(data.values) ? data.values : [];
    values.forEach((valueRow, idx) => {
      if (!isRecord(valueRow)) return;
      const tag = asString(valueRow.tag) || `tag-${idx}`;
      const value = stringifyValue(valueRow.value, 500);
      const decodedValue = `${tag}=${value}`;
      const intValue = asInt(valueRow.value) ?? (value.length > 0 ? value.length : 0);
      rows.push({
        registerType: "tag",
        address: stableAddress(tag),
        rawValue: intValue,
        decodedValue,
        hexValue: intValue !== 0 ? hexOf(intValue) : "",
        isNonZero: intValue !== 0 || value.length > 0,
      });
    });
  } else if (protocol === "dnp3") {
    const active = Array.isArray(data.active_addresses) ? data.active_addresses : [];
    active.forEach((dst, idx) => {
      const address = asInt(dst) ?? idx;
      rows.push({
        registerType: "outstation",
        address,
        rawValue: 1,
        decodedValue: `dst=${address}`,
        isNonZero: true,
      });
    });

    if (isRecord(data.class0)) {
      const size = asInt(data.class0.size) ?? 0;
      const ascii = asString(data.class0.ascii).slice(0, 500);
      const raw = asString(data.class0.raw).slice(0, 1000);
      rows.push({
        registerType: "class0",
        address: 0,
        rawValue: size,
        decodedValue: ascii,
        hexValue: raw,
        isNonZero: size > 0 || ascii.length > 0,
      });
    }
    if (isRecord(data.class123)) {
      const size = asInt(data.class123.size) ?? 0;
      const raw = asString(data.class123.raw).slice(0, 1000);
      rows.push({
        registerType: "class123",
        address: 1,
        rawValue: size,
        decodedValue: asString(data.class123.status),
        hexValue: raw,
        isNonZero: size > 0,
      });
    }
  } else if (protocol === "iec104") {
    const points = Array.isArray(data.data_points) ? data.data_points : [];
    points.forEach((point, idx) => {
      if (!isRecord(point)) return;
      const typeId = asInt(point.type_id) ?? 0;
      const cot = asInt(point.cot) ?? 0;
      const numObjects = asInt(point.num_objects) ?? 0;
      const ascii = asString(point.ascii).slice(0, 500);
      const raw = asString(point.raw).slice(0, 1000);
      rows.push({
        registerType: `asdu:${typeId}`,
        address: idx,
        rawValue: numObjects,
        decodedValue: `cot=${cot} ${ascii}`.trim(),
        hexValue: raw,
        isNonZero: numObjects > 0 || ascii.length > 0,
      });
    });
  } else if (protocol === "bacnet") {
    const objects = Array.isArray(data.objects) ? data.objects : [];
    objects.forEach((objectRow, idx) => {
      if (!isRecord(objectRow)) return;
      const type = asString(objectRow.type) || "object";
      const instance = asInt(objectRow.instance) ?? idx;
      const name = asString(objectRow.name);
      const raw = asString(objectRow.raw).slice(0, 1000);
      rows.push({
        registerType: `object:${type}`,
        address: instance,
        rawValue: name.length,
        decodedValue: name,
        hexValue: raw,
        isNonZero: name.length > 0,
      });
    });
  }

  return dedupeRegisters(rows);
}

function deviceMetadata(protocol: string, data: ScadaTemplateData): {
  vendorName: string;
  productName: string;
  modelName: string;
  revision: string;
  productCode: string;
  description: string;
  deviceType: string;
} {
  const base = {
    vendorName: "",
    productName: "",
    modelName: "",
    revision: "",
    productCode: "",
    description: asString(data.error).slice(0, 500),
    deviceType: protocolToDeviceType(protocol),
  };

  if (protocol === "opcua") {
    const endpointCount = Array.isArray(data.endpoints) ? data.endpoints.length : 0;
    const nodeCount = typeof data.node_count === "number" ? data.node_count : Array.isArray(data.nodes) ? data.nodes.length : 0;
    return {
      ...base,
      productName: "OPC UA Server",
      description: [base.description, `endpoints=${endpointCount}`, `nodes=${nodeCount}`].filter(Boolean).join(" | ").slice(0, 500),
    };
  }

  if (protocol === "s7comm") {
    const cpu = isRecord(data.cpu_info) ? data.cpu_info : {};
    return {
      ...base,
      vendorName: "Siemens",
      productName: asString(cpu.module_type),
      modelName: asString(cpu.module_name),
      revision: asString(cpu.serial),
      description: [base.description, asString(data.cpu_state)].filter(Boolean).join(" | ").slice(0, 500),
    };
  }

  if (protocol === "enip" && isRecord(data.identity)) {
    return {
      ...base,
      vendorName: asString(data.identity.vendor),
      productName: asString(data.identity.product_type),
      modelName: asString(data.identity.name),
      revision: asString(data.identity.revision),
      productCode: asString(data.identity.serial),
      description: base.description,
    };
  }

  if (protocol === "mqtt" || protocol === "mqtt-tls") {
    const topicCount = Array.isArray(data.topics) ? data.topics.length : 0;
    const msgCount = Array.isArray(data.messages_sample) ? data.messages_sample.length : 0;
    return {
      ...base,
      productName: "MQTT Broker",
      description: [base.description, `topics=${topicCount}`, `messages=${msgCount}`].filter(Boolean).join(" | ").slice(0, 500),
    };
  }

  if (protocol === "dnp3") {
    const activeCount = Array.isArray(data.active_addresses) ? data.active_addresses.length : 0;
    return {
      ...base,
      productName: "DNP3 Outstation",
      description: [base.description, `active_addresses=${activeCount}`].filter(Boolean).join(" | ").slice(0, 500),
    };
  }

  if (protocol === "iec104") {
    const count = Array.isArray(data.data_points) ? data.data_points.length : 0;
    return {
      ...base,
      productName: "IEC104 Device",
      description: [base.description, `data_points=${count}`].filter(Boolean).join(" | ").slice(0, 500),
    };
  }

  if (protocol === "bacnet") {
    const count = Array.isArray(data.objects) ? data.objects.length : 0;
    return {
      ...base,
      productName: "BACnet Device",
      description: [base.description, `objects=${count}`].filter(Boolean).join(" | ").slice(0, 500),
    };
  }

  return base;
}

async function upsertRegisters(
  deviceId: string,
  registers: RegisterCandidate[]
): Promise<number> {
  let created = 0;
  for (const row of registers) {
    const decodedValue = (row.decodedValue ?? "").slice(0, 4000);
    const hexValue = (row.hexValue ?? "").slice(0, 4000);
    const isNonZero = row.isNonZero ?? (row.rawValue !== 0 || decodedValue.length > 0);

    await prisma.scadaRegister.upsert({
      where: {
        deviceId_registerType_address: {
          deviceId,
          registerType: row.registerType,
          address: row.address,
        },
      },
      update: {
        rawValue: row.rawValue,
        decodedValue,
        hexValue,
        isNonZero,
        lastUpdated: new Date(),
      },
      create: {
        deviceId,
        registerType: row.registerType,
        address: row.address,
        rawValue: row.rawValue,
        decodedValue,
        hexValue,
        isNonZero,
      },
    });
    created += 1;
  }
  return created;
}

export async function importScadaTemplate(data: ScadaTemplateData): Promise<ImportResult> {
  const result: ImportResult = { format: "scada-template", created: {}, updated: {}, errors: [] };
  let devicesCreated = 0;
  let registersCreated = 0;

  if (!data.host || typeof data.host !== "string") {
    result.errors.push("host field is required for scada-template import");
    return result;
  }

  const protocol = detectTemplateProtocol(data);
  const port = normalizePort(data.port, protocolToDefaultPort(protocol));

  try {
    if (protocol === "modbus" && data.units && isRecord(data.units)) {
      const byUnit = modbusRegistersFromTemplate(data);
      for (const [unitIdKey, registers] of Object.entries(byUnit)) {
        const unitId = asInt(unitIdKey) ?? 1;
        const meta = deviceMetadata(protocol, data);
        const device = await prisma.scadaDevice.upsert({
          where: { host_port_unitId: { host: data.host, port, unitId } },
          update: {
            protocol,
            deviceType: meta.deviceType,
            description: meta.description,
            vendorName: meta.vendorName,
            productName: meta.productName,
            modelName: meta.modelName,
            revision: meta.revision,
            productCode: meta.productCode,
            scanTime: new Date(),
          },
          create: {
            host: data.host,
            port,
            unitId,
            protocol,
            deviceType: meta.deviceType,
            description: meta.description,
            vendorName: meta.vendorName,
            productName: meta.productName,
            modelName: meta.modelName,
            revision: meta.revision,
            productCode: meta.productCode,
          },
        });
        devicesCreated += 1;
        registersCreated += await upsertRegisters(device.id, registers);
      }
    } else {
      const meta = deviceMetadata(protocol, data);
      const device = await prisma.scadaDevice.upsert({
        where: { host_port_unitId: { host: data.host, port, unitId: 1 } },
        update: {
          protocol,
          deviceType: meta.deviceType,
          description: meta.description,
          vendorName: meta.vendorName,
          productName: meta.productName,
          modelName: meta.modelName,
          revision: meta.revision,
          productCode: meta.productCode,
          scanTime: new Date(),
        },
        create: {
          host: data.host,
          port,
          unitId: 1,
          protocol,
          deviceType: meta.deviceType,
          description: meta.description,
          vendorName: meta.vendorName,
          productName: meta.productName,
          modelName: meta.modelName,
          revision: meta.revision,
          productCode: meta.productCode,
        },
      });
      devicesCreated += 1;

      const registers = genericRegistersFromTemplate(data, protocol);
      registersCreated += await upsertRegisters(device.id, registers);
    }
  } catch (e) {
    result.errors.push(`Template ${data.host}:${port}: ${e instanceof Error ? e.message : "unknown error"}`);
  }

  result.created = { devices: devicesCreated, registers: registersCreated };
  return result;
}
