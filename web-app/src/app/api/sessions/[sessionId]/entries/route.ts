import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError, parseBody } from "@/lib/api";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const id = parseInt(sessionId, 10);
    if (isNaN(id)) return apiError("Invalid session ID");

    const body = await parseBody<{
      type: string;
      content: string;
      data?: string;
    }>(request);

    if (!body.type || !body.content?.trim()) {
      return apiError("type and content are required");
    }

    // Auto-calculate next seq
    const lastEntry = await prisma.aiSessionEntry.findFirst({
      where: { sessionId: id },
      orderBy: { seq: "desc" },
      select: { seq: true },
    });
    const nextSeq = (lastEntry?.seq ?? 0) + 1;

    const entry = await prisma.aiSessionEntry.create({
      data: {
        sessionId: id,
        seq: nextSeq,
        type: body.type,
        content: body.content.trim(),
        data: body.data ?? null,
      },
    });

    // Touch session updatedAt
    await prisma.aiSession.update({
      where: { id },
      data: { updatedAt: new Date() },
    });

    return apiSuccess(entry, 201);
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}
