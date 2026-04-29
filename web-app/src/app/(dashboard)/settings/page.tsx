import { prisma } from "@/lib/prisma";
import { SettingsClient } from "@/components/settings/settings-client";

export default async function SettingsPage() {
  const segments = await prisma.networkSegment.findMany({
    orderBy: [{ scope: "asc" }, { order: "asc" }, { name: "asc" }],
    include: {
      ownerHost: { select: { id: true, ip: true, hostname: true } },
    },
  });

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Settings</h1>
      <SettingsClient initialSegments={JSON.parse(JSON.stringify(segments))} />
    </div>
  );
}
