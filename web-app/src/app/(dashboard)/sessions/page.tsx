import { prisma } from "@/lib/prisma";
import { SessionsClient } from "@/components/sessions/sessions-client";

export default async function SessionsPage() {
  const sessions = await prisma.aiSession.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      _count: { select: { entries: true, tasks: true } },
      tasks: { select: { status: true } },
      entries: {
        orderBy: { seq: "desc" },
        take: 3,
        select: { id: true, seq: true, type: true, content: true, createdAt: true },
      },
    },
  });

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">AI Sessions</h1>
      <SessionsClient initialSessions={JSON.parse(JSON.stringify(sessions))} />
    </div>
  );
}
