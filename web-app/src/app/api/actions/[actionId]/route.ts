import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError, parseBody } from "@/lib/api";

/**
 * GET /api/actions/:actionId — get single action details.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ actionId: string }> }) {
  try {
    const { actionId } = await params;
    const action = await prisma.actionItem.findUnique({
      where: { id: actionId },
      include: { session: { select: { id: true, title: true } } },
    });
    if (!action) return apiError("Action not found", 404);
    return apiSuccess(action);
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}

/**
 * PATCH /api/actions/:actionId — update action (claim, complete, fail).
 *
 * For claim (status=in_progress): uses atomic conditional update
 * to prevent race conditions between multiple Claude instances.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ actionId: string }> }) {
  try {
    const { actionId } = await params;
    const body = await parseBody<{
      status?: string;
      sessionId?: number | null;
      result?: string | null;
    }>(request);

    // ── Atomic claim: conditional update WHERE status='pending' ──
    if (body.status === "in_progress" && body.sessionId != null) {
      // Use updateMany with compound condition — returns count=0 if already claimed
      const claimed = await prisma.actionItem.updateMany({
        where: {
          id: actionId,
          status: "pending", // only claim if still pending
        },
        data: {
          status: "in_progress",
          sessionId: body.sessionId,
          claimedAt: new Date(),
        },
      });

      if (claimed.count === 0) {
        // Either not found or already claimed — check which
        const existing = await prisma.actionItem.findUnique({
          where: { id: actionId },
          include: { session: { select: { id: true, title: true } } },
        });
        if (!existing) return apiError("Action not found", 404);
        if (existing.status === "in_progress" && existing.sessionId === body.sessionId) {
          // Same session re-claiming — idempotent, return success
          return apiSuccess(existing);
        }
        // Already claimed by another session or in a different state
        return apiError(
          JSON.stringify({
            error: "Action already claimed or not pending",
            currentStatus: existing.status,
            claimedBy: existing.session
              ? { sessionId: existing.session.id, title: existing.session.title }
              : null,
          }),
          409
        );
      }

      // Fetch and return the claimed action
      const updated = await prisma.actionItem.findUnique({
        where: { id: actionId },
        include: { session: { select: { id: true, title: true } } },
      });
      return apiSuccess(updated);
    }

    // ── Regular update (complete, fail, retry, etc.) ──
    const existing = await prisma.actionItem.findUnique({ where: { id: actionId } });
    if (!existing) return apiError("Action not found", 404);

    const data: Record<string, unknown> = {};

    if (body.status) {
      data.status = body.status;

      // Auto-set timestamps
      if (body.status === "in_progress" && existing.status === "pending") {
        data.claimedAt = new Date();
      }
      if (body.status === "done" || body.status === "failed") {
        data.completedAt = new Date();
      }
      // Reset for retry (pending)
      if (body.status === "pending") {
        data.claimedAt = null;
        data.completedAt = null;
      }
    }

    if (body.sessionId !== undefined) data.sessionId = body.sessionId;
    if (body.result !== undefined) data.result = body.result;

    const updated = await prisma.actionItem.update({
      where: { id: actionId },
      data,
      include: { session: { select: { id: true, title: true } } },
    });

    return apiSuccess(updated);
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}
