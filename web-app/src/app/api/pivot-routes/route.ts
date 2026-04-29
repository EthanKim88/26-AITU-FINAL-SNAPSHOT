import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError, parseBody } from "@/lib/api";

const includeRelations = {
  fromSegment: true,
  toSegment: true,
  pivotHost: { select: { id: true, ip: true, hostname: true } },
  credential: { select: { id: true, username: true, domain: true, secretType: true } },
} as const;

export async function GET() {
  try {
    const routes = await prisma.pivotRoute.findMany({
      include: includeRelations,
      orderBy: { createdAt: "desc" },
    });
    return apiSuccess(routes);
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}

export async function POST(request: Request) {
  try {
    const body = await parseBody<{
      fromSegmentId: string;
      toSegmentId: string;
      pivotHostId: string;
      credentialId?: string;
      protocol?: string;
      port?: number;
      status?: string;
      notes?: string;
    }>(request);

    if (!body.fromSegmentId?.trim()) return apiError("fromSegmentId is required");
    if (!body.toSegmentId?.trim()) return apiError("toSegmentId is required");
    if (!body.pivotHostId?.trim()) return apiError("pivotHostId is required");
    if (body.fromSegmentId === body.toSegmentId) return apiError("fromSegment and toSegment must differ");

    const [fromSeg, toSeg, host] = await Promise.all([
      prisma.networkSegment.findUnique({ where: { id: body.fromSegmentId } }),
      prisma.networkSegment.findUnique({ where: { id: body.toSegmentId } }),
      prisma.host.findUnique({ where: { id: body.pivotHostId } }),
    ]);
    if (!fromSeg) return apiError("fromSegment not found", 404);
    if (!toSeg) return apiError("toSegment not found", 404);
    if (!host) return apiError("pivotHost not found", 404);

    if (body.credentialId) {
      const cred = await prisma.credential.findUnique({ where: { id: body.credentialId } });
      if (!cred) return apiError("credential not found", 404);
    }

    const route = await prisma.pivotRoute.create({
      data: {
        fromSegmentId: body.fromSegmentId,
        toSegmentId: body.toSegmentId,
        pivotHostId: body.pivotHostId,
        credentialId: body.credentialId ?? null,
        protocol: body.protocol ?? "ssh",
        port: body.port ?? 22,
        status: body.status ?? "active",
        notes: body.notes ?? "",
      },
      include: includeRelations,
    });
    return apiSuccess(route, 201);
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}
