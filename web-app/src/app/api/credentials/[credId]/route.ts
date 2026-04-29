import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError, parseBody } from "@/lib/api";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ credId: string }> }
) {
  try {
    const { credId } = await params;
    const credential = await prisma.credential.findUnique({
      where: { id: credId },
      include: {
        accesses: {
          include: { host: { select: { id: true, ip: true, hostname: true } } },
        },
      },
    });
    if (!credential) return apiError("Credential not found", 404);
    return apiSuccess(credential);
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ credId: string }> }
) {
  try {
    const { credId } = await params;
    const body = await parseBody<Partial<{
      username: string; secret: string; secretType: string; credType: string;
      domain: string; linkedService: string; source: string; notes: string;
    }>>(request);
    const credential = await prisma.credential.update({ where: { id: credId }, data: body });
    return apiSuccess(credential);
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ credId: string }> }
) {
  try {
    const { credId } = await params;
    await prisma.credential.delete({ where: { id: credId } });
    return apiSuccess({ deleted: true });
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}
