import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError, parseBody } from "@/lib/api";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ credId: string; accessId: string }> }
) {
  try {
    const { accessId } = await params;
    const body = await parseBody<Partial<{
      protocol: string; status: string; isAdmin: boolean; notes: string;
    }>>(request);
    if (body.status && body.status !== "untested") {
      (body as Record<string, unknown>).testedAt = new Date();
    }
    const access = await prisma.credentialAccess.update({
      where: { id: accessId },
      data: body,
      include: { host: { select: { id: true, ip: true, hostname: true } } },
    });
    return apiSuccess(access);
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ credId: string; accessId: string }> }
) {
  try {
    const { accessId } = await params;
    await prisma.credentialAccess.delete({ where: { id: accessId } });
    return apiSuccess({ deleted: true });
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}
