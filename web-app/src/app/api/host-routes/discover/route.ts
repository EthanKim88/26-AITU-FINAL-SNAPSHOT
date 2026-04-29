import { apiError, apiSuccess, parseBody } from "@/lib/api";
import {
  extractHostRoutesFromOutputs,
  resolveHostId,
  upsertHostRoutes,
} from "@/lib/host-routes";

export async function POST(request: Request) {
  try {
    const body = await parseBody<{
      hostId?: string;
      hostIp?: string;
      replace?: boolean;
      ipRouteOutput?: string;
      ipAddrOutput?: string;
    }>(request);

    const ipRouteOutput = body.ipRouteOutput?.trim() ?? "";
    const ipAddrOutput = body.ipAddrOutput?.trim() ?? "";
    if (!ipRouteOutput && !ipAddrOutput) {
      return apiError("At least one of ipRouteOutput or ipAddrOutput is required");
    }
    if (!body.hostId?.trim() && !body.hostIp?.trim()) {
      return apiError("hostId or hostIp is required");
    }

    const resolvedHostId = await resolveHostId({ hostId: body.hostId, hostIp: body.hostIp });
    if (!resolvedHostId) return apiError("Host not found", 404);

    const parsedRoutes = extractHostRoutesFromOutputs({
      ipRouteOutput,
      ipAddrOutput,
      source: "discovery",
    });

    const result = await upsertHostRoutes({
      hostId: resolvedHostId,
      routes: parsedRoutes,
      replace: body.replace === true,
      defaultSource: "discovery",
    });

    return apiSuccess({
      hostId: resolvedHostId,
      parsedCount: parsedRoutes.length,
      parsedRoutes,
      ...result,
    });
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}
