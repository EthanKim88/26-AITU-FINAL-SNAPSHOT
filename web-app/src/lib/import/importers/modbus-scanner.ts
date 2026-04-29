import { prisma } from "@/lib/prisma";
import type { ImportResult, ModbusScannerData } from "../types";

export async function importModbusScanner(data: ModbusScannerData): Promise<ImportResult> {
  const result: ImportResult = { format: "modbus-scanner", created: {}, updated: {}, errors: [] };
  let devicesCreated = 0, registersCreated = 0;

  for (const d of data.devices) {
    try {
      const device = await prisma.scadaDevice.upsert({
        where: { host_port_unitId: { host: d.host, port: d.port ?? 502, unitId: d.unit_id ?? 1 } },
        update: {
          protocol: d.protocol ?? "modbus",
          description: d.description ?? "",
          deviceType: d.device_type ?? "unknown",
          vendorName: d.vendor_name ?? "", productCode: d.product_code ?? "",
          revision: d.revision ?? "", productName: d.product_name ?? "", modelName: d.model_name ?? "",
          scanTime: new Date(),
        },
        create: {
          host: d.host, port: d.port ?? 502, unitId: d.unit_id ?? 1,
          protocol: d.protocol ?? "modbus",
          description: d.description ?? "",
          deviceType: d.device_type ?? "unknown",
          vendorName: d.vendor_name ?? "", productCode: d.product_code ?? "",
          revision: d.revision ?? "", productName: d.product_name ?? "", modelName: d.model_name ?? "",
        },
      });
      devicesCreated++;

      for (const r of d.registers) {
        await prisma.scadaRegister.upsert({
          where: { deviceId_registerType_address: { deviceId: device.id, registerType: r.register_type, address: r.address } },
          update: {
            rawValue: r.raw_value, decodedValue: r.decoded_value ?? "",
            hexValue: r.hex_value ?? "", isNonZero: r.is_non_zero ?? r.raw_value !== 0,
            lastUpdated: new Date(),
          },
          create: {
            deviceId: device.id, registerType: r.register_type, address: r.address,
            rawValue: r.raw_value, decodedValue: r.decoded_value ?? "",
            hexValue: r.hex_value ?? "", isNonZero: r.is_non_zero ?? r.raw_value !== 0,
          },
        });
        registersCreated++;
      }
    } catch (e) {
      result.errors.push(`Device ${d.host}: ${e instanceof Error ? e.message : "unknown error"}`);
    }
  }

  result.created = { devices: devicesCreated, registers: registersCreated };
  return result;
}
