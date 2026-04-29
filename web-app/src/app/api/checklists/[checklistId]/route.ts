import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError, parseBody } from "@/lib/api";

const PHASES = ["enum", "exploit", "privesc"] as const;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ checklistId: string }> }
) {
  try {
    const { checklistId } = await params;
    const body = await parseBody<Partial<{
      enumStatus: string;
      exploitStatus: string;
      privescStatus: string;
      sessionId: number;
      notes: string;
    }>>(request);

    const data: Record<string, unknown> = {};

    for (const phase of PHASES) {
      const statusKey = `${phase}Status` as keyof typeof body;
      const status = body[statusKey];
      if (!status) continue;

      data[statusKey] = status;
      if (status === "in-progress") {
        data[`${phase}StartedAt`] = new Date();
      } else if (status === "done" || status === "skipped") {
        data[`${phase}CompletedAt`] = new Date();
      }
    }

    if (body.sessionId !== undefined) data.sessionId = body.sessionId;
    if (body.notes !== undefined) data.notes = body.notes;

    const checklist = await prisma.attackChecklist.update({
      where: { id: checklistId },
      data,
      include: {
        host: { select: { id: true, ip: true, hostname: true } },
        session: { select: { id: true, title: true, status: true } },
      },
    });
    return apiSuccess(checklist);
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}
