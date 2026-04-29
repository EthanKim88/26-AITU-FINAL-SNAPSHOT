import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError, parseBody } from "@/lib/api";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ riskId: string }> }
) {
  try {
    const { riskId } = await params;
    const body = await parseBody<Partial<{
      name: string;
      description: string;
    }>>(request);

    const data: {
      name?: string;
      description?: string;
    } = {};

    if (body.name !== undefined) data.name = body.name.trim();
    if (body.description !== undefined) data.description = body.description;

    const item = await prisma.reportRisk.update({
      where: { id: riskId },
      data,
    });

    return apiSuccess(item);
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ riskId: string }> }
) {
  try {
    const { riskId } = await params;
    await prisma.reportRisk.delete({ where: { id: riskId } });
    return apiSuccess({ deleted: true });
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}
