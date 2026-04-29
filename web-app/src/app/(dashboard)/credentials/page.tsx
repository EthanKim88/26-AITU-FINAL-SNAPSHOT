import { prisma } from "@/lib/prisma";
import { CredentialsClient } from "@/components/credentials/credentials-client";

export default async function CredentialsPage() {
  const [credentials, hosts] = await Promise.all([
    prisma.credential.findMany({
      include: {
        accesses: { include: { host: { select: { id: true, ip: true, hostname: true } } } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.host.findMany({
      select: {
        id: true, ip: true, hostname: true,
        ports: { where: { state: "open" }, select: { port: true, service: true }, orderBy: { port: "asc" } },
      },
      orderBy: { ip: "asc" },
    }),
  ]);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Credentials</h1>
      <CredentialsClient
        initialCreds={JSON.parse(JSON.stringify(credentials))}
        hosts={JSON.parse(JSON.stringify(hosts))}
      />
    </div>
  );
}
