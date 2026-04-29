import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError, parseBody } from "@/lib/api";
import { upsertHostRoutes, type HostRouteInput } from "@/lib/host-routes";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ hostId: string }> }
) {
  try {
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
      },
    });
    if (!host) return apiError("Host not found", 404);
    return apiSuccess(host);
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ hostId: string }> }
) {
  try {
    const { hostId } = await params;
    const body = await parseBody<Partial<{
      ip: string; hostname: string; os: string; osVersion: string;
      domain: string; status: string; smbSigning: boolean | null;
      isDc: boolean; notes: string;
      replaceRoutes: boolean;
      routes: HostRouteInput[];
      segments: { segmentId: string; ip?: string }[];
    }>>(request);

    const { segments, routes, replaceRoutes, ...data } = body;
    if (segments) {
      await prisma.hostSegment.deleteMany({ where: { hostId } });
      if (segments.length > 0) {
        await prisma.hostSegment.createMany({
          data: segments.map((s) => ({ hostId, segmentId: s.segmentId, ip: s.ip ?? "" })),
        });
      }
    }

    if (routes) {
      await upsertHostRoutes({
        hostId,
        routes,
        replace: replaceRoutes === true,
        defaultSource: "host-update",
      });
    }

    const host = await prisma.host.update({
      where: { id: hostId },
      data,
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
      },
    });
    return apiSuccess(host);
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ hostId: string }> }
) {
  try {
    const { hostId } = await params;
    await prisma.host.delete({ where: { id: hostId } });
    return apiSuccess({ deleted: true });
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}
