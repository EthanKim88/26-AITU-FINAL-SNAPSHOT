import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError, parseBody } from "@/lib/api";
import { normalizeRequiredRulesInput, stringifyRequiredRules } from "@/lib/report";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ bugTypeId: string }> }
) {
  try {
    const { bugTypeId } = await params;
    const body = await parseBody<Partial<{
      name: string;
      points: number;
      requiredRules: unknown;
    }>>(request);

    const data: {
      name?: string;
      points?: number;
      requiredRules?: string;
    } = {};

    if (body.name !== undefined) data.name = body.name.trim();
    if (body.points !== undefined) data.points = Math.max(0, body.points);
    if (body.requiredRules !== undefined) {
      data.requiredRules = stringifyRequiredRules(normalizeRequiredRulesInput(body.requiredRules));
    }

    const item = await prisma.reportBugType.update({
      where: { id: bugTypeId },
      data,
    });

    return apiSuccess(item);
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ bugTypeId: string }> }
) {
  try {
    const { bugTypeId } = await params;
    await prisma.reportBugType.delete({ where: { id: bugTypeId } });
    return apiSuccess({ deleted: true });
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}
