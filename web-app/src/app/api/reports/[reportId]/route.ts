import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError, parseBody } from "@/lib/api";
import {
  isValidReportStatus,
  isValidReportType,
  validateReportDescriptionMarkdown,
} from "@/lib/report";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ reportId: string }> }
) {
  try {
    const { reportId } = await params;
    const body = await parseBody<Partial<{
      reportType: string;
      bugTypeId: string | null;
      riskId: string | null;
      targetIp: string;
      descriptionMd: string;
      status: string;
      notes: string;
    }>>(request);

    const existing = await prisma.report.findUnique({
      where: { id: reportId },
      include: {
        bugType: true,
      },
    });
    if (!existing) return apiError("Report not found", 404);

    const nextReportType = body.reportType ?? existing.reportType;
    if (!isValidReportType(nextReportType)) return apiError("Invalid reportType");
    if (body.status !== undefined && !isValidReportStatus(body.status)) return apiError("Invalid report status");
    const nextBugTypeId = body.bugTypeId !== undefined ? body.bugTypeId : existing.bugTypeId;
    const nextRiskId = body.riskId !== undefined ? body.riskId : existing.riskId;
    const nextTargetIp = body.targetIp !== undefined ? body.targetIp.trim() : existing.targetIp;
    const nextDescription = body.descriptionMd !== undefined ? body.descriptionMd : existing.descriptionMd;
    const nextStatus = body.status !== undefined ? body.status : existing.status;

    if (nextReportType === "bug_bounty") {
      if (!nextBugTypeId) return apiError("bugTypeId is required for bug_bounty report");
      if (!nextTargetIp) return apiError("targetIp is required for bug_bounty report");
    }
    if (nextReportType === "risk" && !nextRiskId) {
      return apiError("riskId is required for risk report");
    }

    if (nextStatus === "submit") {
      const descriptionErrors = validateReportDescriptionMarkdown(nextDescription);
      if (descriptionErrors.length > 0) return apiError(descriptionErrors.join(" "));
    }

    const data: {
      reportType?: string;
      bugTypeId?: string | null;
      riskId?: string | null;
      targetIp?: string;
      descriptionMd?: string;
      status?: string;
      notes?: string;
      submittedAt?: Date | null;
    } = {};

    if (body.reportType !== undefined) data.reportType = nextReportType;
    if (body.bugTypeId !== undefined) data.bugTypeId = body.bugTypeId;
    if (body.riskId !== undefined) data.riskId = body.riskId;
    if (body.targetIp !== undefined) data.targetIp = nextTargetIp;
    if (body.descriptionMd !== undefined) data.descriptionMd = nextDescription;
    if (body.status !== undefined && body.status !== existing.status) data.status = body.status;
    if (body.notes !== undefined) data.notes = body.notes;

    if (nextStatus === "submit" && existing.submittedAt === null) {
      data.submittedAt = new Date();
    }

    const report = await prisma.report.update({
      where: { id: reportId },
      data,
      include: {
        bugType: true,
        risk: true,
        attachments: { orderBy: { createdAt: "desc" } },
      },
    });

    return apiSuccess(report);
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ reportId: string }> }
) {
  try {
    const { reportId } = await params;
    await prisma.report.delete({ where: { id: reportId } });
    return apiSuccess({ deleted: true });
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}
