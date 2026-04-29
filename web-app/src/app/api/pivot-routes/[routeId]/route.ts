import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError, parseBody } from "@/lib/api";

const includeRelations = {
  fromSegment: true,
  toSegment: true,
  pivotHost: { select: { id: true, ip: true, hostname: true } },
  credential: { select: { id: true, username: true, domain: true, secretType: true } },
} as const;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ routeId: string }> }
) {
  try {
    const { routeId } = await params;
    const body = await parseBody<Partial<{
      fromSegmentId: string;
      toSegmentId: string;
      pivotHostId: string;
      credentialId: string | null;
      protocol: string;
      port: number;
      status: string;
      notes: string;
    }>>(request);

    const route = await prisma.pivotRoute.update({
      where: { id: routeId },
      data: body,
      include: includeRelations,
    });
    return apiSuccess(route);
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ routeId: string }> }
) {
  try {
    const { routeId } = await params;
    await prisma.pivotRoute.delete({ where: { id: routeId } });
    return apiSuccess({ deleted: true });
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}
