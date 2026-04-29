import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError, parseBody } from "@/lib/api";
import { autoAssignSegments } from "@/lib/segment-utils";

type SegmentScope = "global" | "host-local";

function normalizeScope(value?: string): SegmentScope {
  return value === "host-local" ? "host-local" : "global";
}

export async function GET() {
  try {
    const segments = await prisma.networkSegment.findMany({
      include: {
        ownerHost: { select: { id: true, ip: true, hostname: true } },
        _count: { select: { hostLinks: true } },
      },
      orderBy: [{ scope: "asc" }, { order: "asc" }, { name: "asc" }],
    });
    return apiSuccess(segments);
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}

export async function POST(request: Request) {
  try {
    const body = await parseBody<{
      name: string;
      cidr?: string;
      description?: string;
      order?: number;
      scope?: string;
      ownerHostId?: string;
    }>(request);
    if (!body.name?.trim()) return apiError("name is required");

    const scope = normalizeScope(body.scope);
    const ownerHostId = body.ownerHostId?.trim() || null;
    const cidr = body.cidr?.trim() ?? "";

    if (scope === "host-local" && !ownerHostId) {
      return apiError("ownerHostId is required when scope is host-local");
    }
    if (scope === "global" && ownerHostId) {
      return apiError("ownerHostId is not allowed when scope is global");
    }

    if (ownerHostId) {
      const ownerHost = await prisma.host.findUnique({
        where: { id: ownerHostId },
        select: { id: true },
      });
      if (!ownerHost) return apiError("ownerHost not found", 404);
    }

    if (scope === "global" && cidr) {
      const existing = await prisma.networkSegment.findFirst({
        where: { scope: "global", ownerHostId: null, cidr },
        select: { id: true, name: true },
      });
      if (existing) {
        return apiError(`Global segment with cidr "${cidr}" already exists (${existing.name})`, 409);
      }
    }

    const segment = await prisma.networkSegment.create({
      data: {
        name: body.name.trim(),
        cidr,
        description: body.description ?? "",
        order: body.order ?? 0,
        scope,
        ownerHostId: scope === "host-local" ? ownerHostId : null,
      },
      include: {
        ownerHost: { select: { id: true, ip: true, hostname: true } },
        _count: { select: { hostLinks: true } },
      },
    });

    // Auto-assign existing hosts only for global CIDR segments.
    if (scope === "global" && cidr) {
      await autoAssignSegments();
    }

    return apiSuccess(segment, 201);
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}
