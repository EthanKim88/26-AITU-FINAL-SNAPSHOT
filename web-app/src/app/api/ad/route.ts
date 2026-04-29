import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/api";

export async function GET() {
  try {
    const domains = await prisma.adDomain.findMany({
      include: {
        _count: { select: { users: true, groups: true, computers: true, trusts: true, gpos: true } },
      },
      orderBy: { scanTime: "desc" },
    });
    return apiSuccess(domains);
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}
