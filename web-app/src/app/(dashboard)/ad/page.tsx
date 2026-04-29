import { prisma } from "@/lib/prisma";
import { AdClient } from "@/components/ad/ad-client";

export default async function AdPage() {
  const [domains, adHosts, domainCreds, checklists] = await Promise.all([
    prisma.adDomain.findMany({
      include: {
        _count: { select: { users: true, groups: true, computers: true, trusts: true, gpos: true } },
      },
      orderBy: { scanTime: "desc" },
    }),
    // AD hosts: isDc=true OR has a domain set
    prisma.host.findMany({
      where: { OR: [{ isDc: true }, { domain: { not: "" } }] },
      include: {
        ports: { orderBy: { port: "asc" } },
        checklists: {
          include: { session: { select: { id: true, title: true, status: true } } },
        },
        accesses: {
          include: {
            credential: { select: { id: true, username: true, domain: true, credType: true, secretType: true } },
          },
        },
      },
      orderBy: { ip: "asc" },
    }),
    prisma.credential.findMany({
      where: { credType: "domain" },
      include: {
        accesses: {
          include: { host: { select: { id: true, ip: true, hostname: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.attackChecklist.findMany({
      where: {
        host: { OR: [{ isDc: true }, { domain: { not: "" } }] },
      },
      include: {
        host: { select: { id: true, ip: true, hostname: true, os: true, domain: true, isDc: true } },
        session: { select: { id: true, title: true, status: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Active Directory</h1>
      <AdClient
        initialDomains={JSON.parse(JSON.stringify(domains))}
        initialAdHosts={JSON.parse(JSON.stringify(adHosts))}
        initialDomainCreds={JSON.parse(JSON.stringify(domainCreds))}
        initialChecklists={JSON.parse(JSON.stringify(checklists))}
      />
    </div>
  );
}
