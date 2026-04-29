import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError, parseBody } from "@/lib/api";

type SegmentScope = "global" | "host-local";

function normalizeScope(value?: string): SegmentScope | undefined {
  if (value === undefined) return undefined;
  return value === "host-local" ? "host-local" : "global";
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ segmentId: string }> }
) {
  try {
    const { segmentId } = await params;
    const body = await parseBody<Partial<{
      name: string;
      cidr: string;
      description: string;
      order: number;
      reachable: boolean;
      scope: string;
      ownerHostId: string | null;
    }>>(request);

    const existing = await prisma.networkSegment.findUnique({
      where: { id: segmentId },
      select: { id: true, scope: true, ownerHostId: true, cidr: true },
    });
    if (!existing) return apiError("Segment not found", 404);

    const nextScope = (normalizeScope(body.scope) ?? existing.scope) as SegmentScope;
    const requestedOwnerHostId = body.ownerHostId === undefined ? existing.ownerHostId : (body.ownerHostId?.trim() || null);

    if (nextScope === "host-local" && !requestedOwnerHostId) {
      return apiError("ownerHostId is required when scope is host-local");
    }
    if (nextScope === "global" && requestedOwnerHostId) {
      return apiError("ownerHostId is not allowed when scope is global");
    }

    if (requestedOwnerHostId) {
      const ownerHost = await prisma.host.findUnique({
        where: { id: requestedOwnerHostId },
        select: { id: true },
      });
      if (!ownerHost) return apiError("ownerHost not found", 404);
    }

    const cidr = body.cidr === undefined ? undefined : body.cidr.trim();
    const candidateCidr = cidr ?? existing.cidr;
    if (nextScope === "global" && candidateCidr) {
      const dup = await prisma.networkSegment.findFirst({
        where: {
          id: { not: segmentId },
          scope: "global",
          ownerHostId: null,
          cidr: candidateCidr,
        },
        select: { id: true, name: true },
      });
      if (dup) {
        return apiError(`Global segment with cidr "${candidateCidr}" already exists (${dup.name})`, 409);
      }
    }

    const updateData: Partial<{
      name: string;
      description: string;
      order: number;
      reachable: boolean;
      cidr: string;
      scope: SegmentScope;
      ownerHostId: string | null;
    }> = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.order !== undefined) updateData.order = body.order;
    if (body.reachable !== undefined) updateData.reachable = body.reachable;
    if (cidr !== undefined) updateData.cidr = cidr;
    if (body.scope !== undefined) updateData.scope = nextScope;
    if (body.ownerHostId !== undefined || body.scope !== undefined) {
      updateData.ownerHostId = nextScope === "host-local" ? requestedOwnerHostId : null;
    }

    const segment = await prisma.networkSegment.update({
      where: { id: segmentId },
      data: updateData,
      include: {
        ownerHost: { select: { id: true, ip: true, hostname: true } },
        _count: { select: { hostLinks: true } },
      },
    });
    return apiSuccess(segment);
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ segmentId: string }> }
) {
  try {
    const { segmentId } = await params;
    await prisma.networkSegment.delete({ where: { id: segmentId } });
    return apiSuccess({ deleted: true });
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}
