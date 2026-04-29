import { prisma } from "@/lib/prisma";
import { ActionsClient } from "@/components/actions/actions-client";

export default async function ActionsPage() {
  const [actions, sessions] = await Promise.all([
    prisma.actionItem.findMany({
      orderBy: { createdAt: "desc" },
      include: { session: { select: { id: true, title: true } } },
      take: 200,
    }),
    prisma.aiSession.findMany({
      where: { status: "active" },
      select: { id: true, title: true },
    }),
  ]);

  // Compute summary stats
  const stats = {
    pending: actions.filter((a) => a.status === "pending").length,
    inProgress: actions.filter((a) => a.status === "in_progress").length,
    done: actions.filter((a) => a.status === "done").length,
    failed: actions.filter((a) => a.status === "failed").length,
    expired: actions.filter((a) => a.status === "expired").length,
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Action Queue</h1>
      <ActionsClient
        initialActions={JSON.parse(JSON.stringify(actions))}
        activeSessions={sessions}
        stats={stats}
      />
    </div>
  );
}
