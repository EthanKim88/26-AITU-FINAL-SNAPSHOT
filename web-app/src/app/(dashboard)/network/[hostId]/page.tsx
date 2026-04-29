import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { HostDetail } from "@/components/network/host-detail";

export default async function HostDetailPage({
  params,
}: {
  params: Promise<{ hostId: string }>;
}) {
  const { hostId } = await params;

  const host = await prisma.host.findUnique({
    where: { id: hostId },
    include: {
      segments: {
        include: {
          segment: {
            include: {
              ownerHost: { select: { id: true, ip: true, hostname: true } },
            },
          },
        },
      },
      ports: { orderBy: { port: "asc" } },
      routes: { orderBy: [{ isDefault: "desc" }, { destination: "asc" }, { iface: "asc" }] },
      accesses: { include: { credential: true } },
      checklists: true,
      pivotRoutes: {
        include: {
          fromSegment: { include: { ownerHost: { select: { id: true, ip: true, hostname: true } } } },
          toSegment: { include: { ownerHost: { select: { id: true, ip: true, hostname: true } } } },
          credential: { select: { username: true, domain: true } },
        },
      },
    },
  });

  if (!host) notFound();

  return (
    <div>
      <HostDetail host={JSON.parse(JSON.stringify(host))} />
    </div>
  );
}
