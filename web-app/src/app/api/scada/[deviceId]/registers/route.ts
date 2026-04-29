import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError, parseBody } from "@/lib/api";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ deviceId: string }> }
) {
  try {
    const { deviceId } = await params;
    const body = await parseBody<{
      registers: { registerType: string; address: number; rawValue: number; decodedValue?: string; hexValue?: string }[];
    }>(request);

    let updated = 0;
    for (const r of body.registers) {
      await prisma.scadaRegister.upsert({
        where: { deviceId_registerType_address: { deviceId, registerType: r.registerType, address: r.address } },
        update: {
          rawValue: r.rawValue, decodedValue: r.decodedValue ?? "",
          hexValue: r.hexValue ?? "", isNonZero: r.rawValue !== 0,
          lastUpdated: new Date(),
        },
        create: {
          deviceId, registerType: r.registerType, address: r.address,
          rawValue: r.rawValue, decodedValue: r.decodedValue ?? "",
          hexValue: r.hexValue ?? "", isNonZero: r.rawValue !== 0,
        },
      });
      updated++;
    }
    return apiSuccess({ updated });
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}
