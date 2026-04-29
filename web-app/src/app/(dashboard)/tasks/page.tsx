import { prisma } from "@/lib/prisma";
import { TasksClient } from "@/components/tasks/tasks-client";

export default async function TasksPage() {
  const tasks = await prisma.taskRequest.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      session: { select: { id: true, title: true } },
    },
  });

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Task Requests</h1>
      <TasksClient initialTasks={JSON.parse(JSON.stringify(tasks))} />
    </div>
  );
}
