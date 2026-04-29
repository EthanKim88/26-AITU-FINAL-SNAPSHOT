import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError, parseBody } from "@/lib/api";

export async function GET(request: NextRequest) {
  try {
    const status = request.nextUrl.searchParams.get("status");
    const sessionId = request.nextUrl.searchParams.get("sessionId");

    const tasks = await prisma.taskRequest.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(sessionId ? { sessionId: parseInt(sessionId, 10) } : {}),
      },
      include: {
        session: { select: { id: true, title: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return apiSuccess(tasks);
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}

export async function POST(request: Request) {
  try {
    const body = await parseBody<{
      type: string;
      title: string;
      priority?: string;
      command?: string;
      context?: string;
      expectedOutput?: string;
      hostIp?: string;
      sessionId?: number;
    }>(request);

    if (!body.type || !body.title?.trim()) {
      return apiError("type and title are required");
    }

    const task = await prisma.taskRequest.create({
      data: {
        type: body.type,
        title: body.title.trim(),
        priority: body.priority ?? "medium",
        command: body.command ?? null,
        context: body.context ?? null,
        expectedOutput: body.expectedOutput ?? null,
        hostIp: body.hostIp ?? null,
        sessionId: body.sessionId ?? null,
      },
    });
    return apiSuccess(task, 201);
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}
