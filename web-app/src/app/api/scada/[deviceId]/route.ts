import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError, parseBody } from "@/lib/api";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ deviceId: string }> }
) {
  try {
    const { deviceId } = await params;
    const device = await prisma.scadaDevice.findUnique({
      where: { id: deviceId },
      include: { registers: { orderBy: [{ registerType: "asc" }, { address: "asc" }] } },
    });
    if (!device) return apiError("Device not found", 404);
    return apiSuccess(device);
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ deviceId: string }> }
) {
  try {
    const { deviceId } = await params;
    const body = await parseBody<Partial<{
      host: string; port: number; unitId: number;
      protocol: string; description: string; deviceType: string;
      vendorName: string; productCode: string; productName: string; modelName: string;
    }>>(request);
    const device = await prisma.scadaDevice.update({ where: { id: deviceId }, data: body });
    return apiSuccess(device);
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ deviceId: string }> }
) {
  try {
    const { deviceId } = await params;
    await prisma.scadaDevice.delete({ where: { id: deviceId } });
    return apiSuccess({ deleted: true });
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}
