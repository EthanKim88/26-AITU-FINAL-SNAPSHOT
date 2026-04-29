import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError, parseBody } from "@/lib/api";

export async function GET() {
  try {
    const devices = await prisma.scadaDevice.findMany({
      include: { _count: { select: { registers: true } } },
      orderBy: { scanTime: "desc" },
    });
    return apiSuccess(devices);
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}

export async function POST(request: Request) {
  try {
    const body = await parseBody<{
      host: string; port?: number; unitId?: number;
      protocol?: string; description?: string; deviceType?: string;
      vendorName?: string; productCode?: string; productName?: string; modelName?: string;
    }>(request);
    if (!body.host) return apiError("host is required");
    const device = await prisma.scadaDevice.create({
      data: {
        host: body.host, port: body.port ?? 502, unitId: body.unitId ?? 1,
        protocol: body.protocol ?? "modbus",
        description: body.description ?? "",
        deviceType: body.deviceType ?? "unknown",
        vendorName: body.vendorName ?? "", productCode: body.productCode ?? "",
        productName: body.productName ?? "", modelName: body.modelName ?? "",
      },
    });
    return apiSuccess(device, 201);
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}
