import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError, parseBody } from "@/lib/api";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const id = parseInt(sessionId, 10);
    if (isNaN(id)) return apiError("Invalid session ID");

    const brief = request.nextUrl.searchParams.get("brief") === "true";

    const session = await prisma.aiSession.findUnique({
      where: { id },
      include: {
        entries: {
          orderBy: { seq: "desc" },
          ...(brief ? { take: 5 } : {}),
        },
        tasks: brief
          ? { where: { status: { in: ["pending", "in-progress"] } }, orderBy: { createdAt: "desc" } }
          : { orderBy: { createdAt: "desc" } },
      },
    });

    if (!session) return apiError("Session not found", 404);

    // Reverse entries to chronological order
    return apiSuccess({ ...session, entries: session.entries.reverse() });
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const id = parseInt(sessionId, 10);
    if (isNaN(id)) return apiError("Invalid session ID");

    const body = await parseBody<Partial<{
      title: string;
      status: string;
      goal: string;
      summary: string;
      heartbeat: boolean;
    }>>(request);

    // Extract heartbeat marker and build update data
    const { heartbeat, ...updateData } = body;
    const data: Record<string, unknown> = { ...updateData };
    if (heartbeat) {
      data.lastHeartbeat = new Date();
    }

    const session = await prisma.aiSession.update({
      where: { id },
      data,
    });
    return apiSuccess(session);
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}
