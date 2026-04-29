import { prisma } from "@/lib/prisma";
import { NetworkClient } from "@/components/network/network-client";

export default async function NetworkPage() {
  const [hosts, segments] = await Promise.all([
    prisma.host.findMany({
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
        accesses: { include: { credential: { select: { username: true, domain: true, credType: true } } } },
      },
      orderBy: { ip: "asc" },
    }),
    prisma.networkSegment.findMany({
      orderBy: [{ scope: "asc" }, { order: "asc" }, { name: "asc" }],
      include: {
        ownerHost: { select: { id: true, ip: true, hostname: true } },
        _count: { select: { hostLinks: true } },
      },
    }),
  ]);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Network</h1>
      <NetworkClient
        initialHosts={JSON.parse(JSON.stringify(hosts))}
        initialSegments={JSON.parse(JSON.stringify(segments))}
      />
    </div>
  );
}
