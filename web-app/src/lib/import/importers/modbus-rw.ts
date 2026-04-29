import { prisma } from "@/lib/prisma";
import type { ImportResult, ModbusRwData } from "../types";

export async function importModbusRw(data: ModbusRwData): Promise<ImportResult> {
  const result: ImportResult = { format: "modbus-rw", created: {}, updated: {}, errors: [] };
  let registersUpdated = 0;

  const registers = data.registers || data.read_results || [];
  if (registers.length === 0) {
    result.errors.push("No registers found in data");
    return result;
  }

  const host = data.host;
  const port = data.port ?? 502;
  const unitId = data.unit_id ?? 1;

  if (!host) {
    result.errors.push("host field is required for modbus-rw import");
    return result;
  }

  const device = await prisma.scadaDevice.findUnique({
    where: { host_port_unitId: { host, port, unitId } },
  });

  if (!device) {
    result.errors.push(`Device ${host}:${port} unit ${unitId} not found. Import modbus-scanner data first.`);
    return result;
  }

  for (const r of registers) {
    try {
      await prisma.scadaRegister.upsert({
        where: { deviceId_registerType_address: { deviceId: device.id, registerType: r.register_type, address: r.address } },
        update: {
          rawValue: r.raw_value, decodedValue: r.decoded_value ?? "",
          hexValue: r.hex_value ?? "", isNonZero: r.raw_value !== 0, lastUpdated: new Date(),
        },
        create: {
          deviceId: device.id, registerType: r.register_type, address: r.address,
          rawValue: r.raw_value, decodedValue: r.decoded_value ?? "",
          hexValue: r.hex_value ?? "", isNonZero: r.raw_value !== 0,
        },
      });
      registersUpdated++;
    } catch (e) {
      result.errors.push(`Register ${r.register_type}:${r.address}: ${e instanceof Error ? e.message : "unknown"}`);
    }
  }

  result.updated = { registers: registersUpdated };
  return result;
}
