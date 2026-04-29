import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError, parseBody } from "@/lib/api";

const INCLUDE = {
  host: { select: { id: true, ip: true, hostname: true } },
  session: { select: { id: true, title: true, status: true } },
} as const;

export async function POST(request: Request) {
  try {
    const body = await parseBody<{
      hostId: string;
      sessionId: number;
      notes?: string;
    }>(request);

    if (!body.hostId || !body.sessionId) {
      return apiError("hostId and sessionId are required", 400);
    }

    // Check existing checklist for this host
    const existing = await prisma.attackChecklist.findFirst({
      where: { hostId: body.hostId },
    });

    if (existing) {
      // Already claimed by another session
      if (existing.sessionId && existing.sessionId !== body.sessionId) {
        return apiError(
          `Host already claimed by session #${existing.sessionId}`,
          409
        );
      }

      // Claim + start enum if still pending
      const updated = await prisma.attackChecklist.update({
        where: { id: existing.id },
        data: {
          sessionId: body.sessionId,
          enumStatus:
            existing.enumStatus === "pending"
              ? "in-progress"
              : existing.enumStatus,
          enumStartedAt:
            existing.enumStatus === "pending"
              ? new Date()
              : existing.enumStartedAt,
          ...(body.notes ? { notes: body.notes } : {}),
        },
        include: INCLUDE,
      });
      return apiSuccess(updated);
    }

    // Verify host exists
    const host = await prisma.host.findUnique({
      where: { id: body.hostId },
    });
    if (!host) {
      return apiError("Host not found", 404);
    }

    // Create new checklist with claim
    const checklist = await prisma.attackChecklist.create({
      data: {
        hostId: body.hostId,
        hostIp: host.ip,
        sessionId: body.sessionId,
        enumStatus: "in-progress",
        enumStartedAt: new Date(),
        notes: body.notes ?? "",
      },
      include: INCLUDE,
    });
    return apiSuccess(checklist, 201);
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}
