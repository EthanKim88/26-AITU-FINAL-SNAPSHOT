import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError, parseBody } from "@/lib/api";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params;
    const body = await parseBody<Partial<{
      status: string;
      result: string;
      priority: string;
      command: string;
      context: string;
      expectedOutput: string;
    }>>(request);

    const task = await prisma.taskRequest.update({
      where: { id: taskId },
      data: body,
    });
    return apiSuccess(task);
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}
