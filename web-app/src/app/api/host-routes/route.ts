import { NextRequest } from "next/server";
import { apiError, apiSuccess, parseBody } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { resolveHostId, upsertHostRoutes, type HostRouteInput } from "@/lib/host-routes";

export async function GET(request: NextRequest) {
  try {
    const hostIdQuery = request.nextUrl.searchParams.get("hostId") ?? undefined;
    const hostIpQuery = request.nextUrl.searchParams.get("hostIp") ?? undefined;

    let where: { hostId?: string } = {};
    if (hostIdQuery || hostIpQuery) {
      const resolvedHostId = await resolveHostId({ hostId: hostIdQuery, hostIp: hostIpQuery });
      if (!resolvedHostId) return apiError("Host not found", 404);
      where = { hostId: resolvedHostId };
    }

    const routes = await prisma.hostRoute.findMany({
      where,
      include: { host: { select: { id: true, ip: true, hostname: true } } },
      orderBy: [{ hostId: "asc" }, { isDefault: "desc" }, { destination: "asc" }, { iface: "asc" }],
    });
    return apiSuccess(routes);
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}

export async function POST(request: Request) {
  try {
    const body = await parseBody<{
      hostId?: string;
      hostIp?: string;
      replace?: boolean;
      source?: string;
      routes: HostRouteInput[];
    }>(request);

    if (!Array.isArray(body.routes) || body.routes.length === 0) {
      return apiError("routes array is required");
    }
    if (!body.hostId?.trim() && !body.hostIp?.trim()) {
      return apiError("hostId or hostIp is required");
    }

    const resolvedHostId = await resolveHostId({ hostId: body.hostId, hostIp: body.hostIp });
    if (!resolvedHostId) return apiError("Host not found", 404);

    const result = await upsertHostRoutes({
      hostId: resolvedHostId,
      routes: body.routes,
      replace: body.replace === true,
      defaultSource: body.source ?? "manual",
    });

    return apiSuccess({
      hostId: resolvedHostId,
      ...result,
    });
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}
