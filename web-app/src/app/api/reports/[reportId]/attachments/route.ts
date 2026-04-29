import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/api";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ reportId: string }> }
) {
  try {
    const { reportId } = await params;
    const attachments = await prisma.reportAttachment.findMany({
      where: { reportId },
      orderBy: { createdAt: "desc" },
    });
    return apiSuccess(attachments);
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ reportId: string }> }
) {
  try {
    const { reportId } = await params;
    const report = await prisma.report.findUnique({ where: { id: reportId }, select: { id: true } });
    if (!report) return apiError("Report not found", 404);
    return apiError("Attachment uploads are disabled. Keep evidence under loots/reports/<report-id>/.", 410);
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}
