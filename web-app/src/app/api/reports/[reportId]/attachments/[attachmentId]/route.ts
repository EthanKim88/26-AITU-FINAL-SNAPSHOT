import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";

export async function PATCH(
  _request: Request,
  { params }: { params: Promise<{ reportId: string; attachmentId: string }> }
) {
  try {
    const { reportId, attachmentId } = await params;
    const existing = await prisma.reportAttachment.findFirst({
      where: { id: attachmentId, reportId },
    });
    if (!existing) return apiError("Attachment not found", 404);
    return apiError("Attachment editing is disabled.", 410);
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ reportId: string; attachmentId: string }> }
) {
  try {
    const { reportId, attachmentId } = await params;
    const attachment = await prisma.reportAttachment.findFirst({
      where: { id: attachmentId, reportId },
    });
    if (!attachment) return apiError("Attachment not found", 404);
    return apiError("Attachment deletion is disabled.", 410);
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}
