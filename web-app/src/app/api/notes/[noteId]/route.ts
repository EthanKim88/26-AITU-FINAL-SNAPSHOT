import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError, parseBody } from "@/lib/api";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ noteId: string }> }
) {
  try {
    const { noteId } = await params;
    const body = await parseBody<Partial<{ content: string; tags: string; host: string }>>(request);
    const note = await prisma.note.update({ where: { id: noteId }, data: body });
    return apiSuccess(note);
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ noteId: string }> }
) {
  try {
    const { noteId } = await params;
    await prisma.note.delete({ where: { id: noteId } });
    return apiSuccess({ deleted: true });
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}
