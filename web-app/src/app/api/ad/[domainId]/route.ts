import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/api";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ domainId: string }> }
) {
  try {
    const { domainId } = await params;
    const domain = await prisma.adDomain.findUnique({
      where: { id: domainId },
      include: {
        users: {
          orderBy: { username: "asc" },
          select: {
            id: true,
            username: true,
            description: true,
            groups: true,
            spn: true,
            kerberoastable: true,
            asrepRoastable: true,
            adminCount: true,
            lastLogon: true,
            pwdLastSet: true,
            constrainedDelegationTargets: true,
            email: true,
          },
        },
        groups: { orderBy: { name: "asc" } },
        computers: {
          orderBy: { name: "asc" },
          select: {
            id: true,
            name: true,
            dnsHostname: true,
            os: true,
            osVersion: true,
            isDc: true,
            unconstrainedDelegation: true,
            constrainedDelegation: true,
            rbcd: true,
          },
        },
        trusts: true,
        gpos: true,
      },
    });
    if (!domain) return apiError("Domain not found", 404);
    return apiSuccess(domain);
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ domainId: string }> }
) {
  try {
    const { domainId } = await params;
    await prisma.adDomain.delete({ where: { id: domainId } });
    return apiSuccess({ deleted: true });
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}
