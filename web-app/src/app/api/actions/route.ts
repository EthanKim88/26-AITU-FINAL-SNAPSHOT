import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError, parseBody } from "@/lib/api";

/**
 * GET /api/actions?status=pending&category=ad&sessionId=1
 * List actions with optional filters.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    const category = url.searchParams.get("category");
    const sessionId = url.searchParams.get("sessionId");
    const target = url.searchParams.get("target");

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (category) where.category = category;
    if (sessionId) where.sessionId = parseInt(sessionId, 10);
    if (target) where.target = target;

    const actions = await prisma.actionItem.findMany({
      where,
      orderBy: [{ status: "asc" }, { priority: "asc" }, { createdAt: "asc" }],
      include: { session: { select: { id: true, title: true } } },
    });

    // Sort by priority weight for better ordering
    const priorityWeight: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    const statusWeight: Record<string, number> = { pending: 0, in_progress: 1, done: 2, failed: 3, expired: 4 };

    actions.sort((a, b) => {
      const sw = (statusWeight[a.status] ?? 9) - (statusWeight[b.status] ?? 9);
      if (sw !== 0) return sw;
      return (priorityWeight[a.priority] ?? 9) - (priorityWeight[b.priority] ?? 9);
    });

    return apiSuccess(actions);
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}

/**
 * POST /api/actions — create a new action (with dedup via fingerprint).
 */
export async function POST(request: Request) {
  try {
    const body = await parseBody<{
      priority?: string;
      action: string;
      reason?: string;
      category?: string;
      target?: string;
      context?: Record<string, unknown>;
      fingerprint: string;
    }>(request);

    if (!body.action || !body.fingerprint) {
      return apiError("action and fingerprint are required", 400);
    }

    // Upsert: if fingerprint exists and is pending, update; if done/failed, skip
    const existing = await prisma.actionItem.findUnique({
      where: { fingerprint: body.fingerprint },
    });

    if (existing) {
      // If action already exists and is pending/in_progress, return it as-is
      if (existing.status === "pending" || existing.status === "in_progress") {
        return apiSuccess(existing);
      }
      // If done/failed/expired, allow re-creation by updating
      const updated = await prisma.actionItem.update({
        where: { id: existing.id },
        data: {
          priority: body.priority || existing.priority,
          action: body.action,
          reason: body.reason || existing.reason,
          category: body.category || existing.category,
          target: body.target ?? existing.target,
          context: JSON.stringify(body.context || {}),
          status: "pending",
          sessionId: null,
          result: null,
          claimedAt: null,
          completedAt: null,
        },
      });
      return apiSuccess(updated);
    }

    const action = await prisma.actionItem.create({
      data: {
        priority: body.priority || "medium",
        action: body.action,
        reason: body.reason || "",
        category: body.category || "recon",
        target: body.target,
        context: JSON.stringify(body.context || {}),
        fingerprint: body.fingerprint,
      },
    });

    return apiSuccess(action);
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}
