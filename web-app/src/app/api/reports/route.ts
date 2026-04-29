import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError, parseBody } from "@/lib/api";
import {
  isProtectedReportStatus,
  isValidReportStatus,
  isValidReportType,
  REPORT_STATUS_PRIORITY,
  resolveReportStatusTransition,
  validateReportDescriptionMarkdown,
} from "@/lib/report";
import { buildDefaultReportDescription, type ReportType } from "@/lib/report-description";

function isPlaceholderDescription(description: string | null | undefined, reportType: ReportType) {
  const normalized = description?.trim() ?? "";
  return !normalized || normalized === buildDefaultReportDescription(reportType);
}

function pickCanonicalReport<T extends { status: string; updatedAt: Date }>(reports: T[]): T | null {
  if (reports.length === 0) return null;

  return [...reports].sort((left, right) => {
    const leftPriority = isValidReportStatus(left.status) ? REPORT_STATUS_PRIORITY[left.status] : -1;
    const rightPriority = isValidReportStatus(right.status) ? REPORT_STATUS_PRIORITY[right.status] : -1;
    if (leftPriority !== rightPriority) return rightPriority - leftPriority;
    return right.updatedAt.getTime() - left.updatedAt.getTime();
  })[0] ?? null;
}

function pickReportForReuse<T extends { status: string; updatedAt: Date }>(
  reports: T[],
  requestedStatus?: string
): T | null {
  if (reports.length === 0) return null;

  const reusableReports = reports.filter((report) => !isProtectedReportStatus(report.status));
  if (reusableReports.length > 0) {
    return [...reusableReports].sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())[0] ?? null;
  }

  // Draft refreshes should not silently create duplicate rows when a canonical
  // submitted/accepted report already exists for the same logical finding.
  if (!requestedStatus || requestedStatus === "pending") {
    return pickCanonicalReport(reports);
  }

  return pickCanonicalReport(reports);
}

export async function GET(request: NextRequest) {
  try {
    const reportType = request.nextUrl.searchParams.get("reportType");
    const status = request.nextUrl.searchParams.get("status");
    const targetIp = request.nextUrl.searchParams.get("targetIp");
    const reports = await prisma.report.findMany({
      where: {
        ...(reportType ? { reportType } : {}),
        ...(status ? { status } : {}),
        ...(targetIp ? { targetIp: { contains: targetIp } } : {}),
      },
      include: {
        bugType: true,
        risk: true,
        attachments: { orderBy: { createdAt: "desc" } },
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    });
    return apiSuccess(reports);
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}

export async function POST(request: Request) {
  try {
    const body = await parseBody<{
      reportId?: string;
      reportType: "bug_bounty" | "risk";
      bugTypeId?: string | null;
      riskId?: string | null;
      targetIp?: string;
      descriptionMd?: string;
      status?: string;
      notes?: string;
    }>(request);

    if (!isValidReportType(body.reportType)) return apiError("reportType must be bug_bounty or risk");
    if (body.status && !isValidReportStatus(body.status)) return apiError("Invalid report status");

    if (body.reportType === "bug_bounty") {
      if (!body.bugTypeId) return apiError("bugTypeId is required for bug_bounty report");
      if (body.status === "submit" && !body.targetIp?.trim()) return apiError("targetIp is required for bug_bounty report");
    } else {
      if (!body.riskId) return apiError("riskId is required for risk report");
    }

    const descriptionMd = body.descriptionMd?.trim() || buildDefaultReportDescription(body.reportType);
    const descriptionErrors = validateReportDescriptionMarkdown(descriptionMd);
    if (descriptionErrors.length > 0 && body.status === "submit") {
      return apiError(descriptionErrors.join(" "));
    }

    const targetIp = body.targetIp?.trim() ?? "";
    const existingCandidates = body.reportType === "bug_bounty"
      ? (
        body.bugTypeId && targetIp
          ? await prisma.report.findMany({
            where: {
              reportType: "bug_bounty",
              bugTypeId: body.bugTypeId,
              targetIp,
            },
            include: {
              bugType: true,
              risk: true,
              attachments: { orderBy: { createdAt: "desc" } },
            },
            orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
          })
          : []
      )
      : (
        body.riskId
          ? await prisma.report.findMany({
            where: {
              reportType: "risk",
              riskId: body.riskId,
            },
            include: {
              bugType: true,
              risk: true,
              attachments: { orderBy: { createdAt: "desc" } },
            },
            orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
          })
          : []
      );

    const existing = body.reportId
      ? existingCandidates.find((candidate) => candidate.id === body.reportId) ?? null
      : pickReportForReuse(existingCandidates, body.status);

    if (body.reportId && !existing) {
      return apiError("Report not found for the provided logical key", 404);
    }

    if (existing) {
      const data: {
        bugTypeId?: string | null;
        riskId?: string | null;
        targetIp?: string;
        descriptionMd?: string;
        status?: string;
        notes?: string;
        submittedAt?: Date;
      } = {};

      if (body.reportType === "bug_bounty" && body.bugTypeId && existing.bugTypeId !== body.bugTypeId) {
        data.bugTypeId = body.bugTypeId;
      }

      if (body.reportType === "risk" && body.riskId && existing.riskId !== body.riskId) {
        data.riskId = body.riskId;
      }

      if (targetIp && existing.targetIp !== targetIp) {
        data.targetIp = targetIp;
      }

      if (body.descriptionMd !== undefined) {
        const incomingDescription = body.descriptionMd.trim();
        const incomingIsPlaceholder = isPlaceholderDescription(incomingDescription, body.reportType);
        const existingIsPlaceholder = isPlaceholderDescription(existing.descriptionMd, body.reportType);
        if (incomingDescription && (!incomingIsPlaceholder || existingIsPlaceholder) && existing.descriptionMd !== incomingDescription) {
          data.descriptionMd = incomingDescription;
        }
      }

      if (body.notes !== undefined) {
        const incomingNotes = body.notes.trim();
        if (incomingNotes && existing.notes !== incomingNotes) {
          data.notes = incomingNotes;
        }
      }

      const nextStatus = resolveReportStatusTransition(existing.status, body.status);
      if (nextStatus) {
        data.status = nextStatus;
        if (nextStatus === "submit" && existing.submittedAt === null) {
          data.submittedAt = new Date();
        }
      }

      if (Object.keys(data).length === 0) {
        return apiSuccess(existing);
      }

      const reused = await prisma.report.update({
        where: { id: existing.id },
        data,
        include: {
          bugType: true,
          risk: true,
          attachments: { orderBy: { createdAt: "desc" } },
        },
      });

      return apiSuccess(reused);
    }

    const report = await prisma.report.create({
      data: {
        reportType: body.reportType,
        bugTypeId: body.reportType === "bug_bounty" ? (body.bugTypeId ?? null) : null,
        riskId: body.reportType === "risk" ? (body.riskId ?? null) : null,
        targetIp,
        descriptionMd,
        status: body.status && isValidReportStatus(body.status) ? body.status : "pending",
        notes: body.notes ?? "",
      },
      include: {
        bugType: true,
        risk: true,
        attachments: { orderBy: { createdAt: "desc" } },
      },
    });

    return apiSuccess(report, 201);
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}
