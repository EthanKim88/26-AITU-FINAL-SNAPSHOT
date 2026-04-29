import { prisma } from "@/lib/prisma";
import { TimelineClient } from "@/components/timeline/timeline-client";

export default async function TimelinePage() {
  const events = await prisma.event.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Timeline</h1>
      <TimelineClient initialEvents={JSON.parse(JSON.stringify(events))} />
    </div>
  );
}
