import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError, parseBody } from "@/lib/api";

export async function GET() {
  try {
    const sessions = await prisma.aiSession.findMany({
      orderBy: { updatedAt: "desc" },
      include: {
        _count: { select: { entries: true, tasks: true } },
        tasks: { select: { status: true } },
      },
    });

    const result = sessions.map((s) => {
      const tasksByStatus: Record<string, number> = {};
      for (const t of s.tasks) {
        tasksByStatus[t.status] = (tasksByStatus[t.status] ?? 0) + 1;
      }
      const { tasks, ...rest } = s;
      return { ...rest, tasksByStatus };
    });

    return apiSuccess(result);
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}

export async function POST(request: Request) {
  try {
    const body = await parseBody<{ title: string; goal?: string }>(request);
    if (!body.title?.trim()) return apiError("title is required");

    const session = await prisma.aiSession.create({
      data: { title: body.title.trim(), goal: body.goal ?? null },
    });
    return apiSuccess(session, 201);
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}
