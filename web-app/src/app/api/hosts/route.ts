import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError, parseBody } from "@/lib/api";
import { upsertHostRoutes, type HostRouteInput } from "@/lib/host-routes";

export async function GET(request: NextRequest) {
  try {
    const segmentId = request.nextUrl.searchParams.get("segmentId");
    const unassigned = request.nextUrl.searchParams.get("unassigned") === "true";

    const hosts = await prisma.host.findMany({
      where: {
        ...(segmentId ? { segments: { some: { segmentId } } } : {}),
        ...(unassigned ? { segments: { none: {} } } : {}),
      },
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
        accesses: { include: { credential: { select: { username: true, domain: true, credType: true } } } },
      },
      orderBy: { ip: "asc" },
    });
    return apiSuccess(hosts);
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}

export async function POST(request: Request) {
  try {
    const body = await parseBody<{
      ip: string;
      hostname?: string;
      os?: string;
      osVersion?: string;
      domain?: string;
      status?: string;
      smbSigning?: boolean | null;
      isDc?: boolean;
      notes?: string;
      routes?: HostRouteInput[];
      segments?: { segmentId: string; ip?: string }[];
      ports?: { port: number; protocol?: string; service?: string; version?: string; banner?: string }[];
    }>(request);
    if (!body.ip?.trim()) return apiError("ip is required");

    const host = await prisma.host.create({
      data: {
        ip: body.ip.trim(),
        hostname: body.hostname ?? "",
        os: body.os ?? "",
        osVersion: body.osVersion ?? "",
        domain: body.domain ?? "",
        status: body.status ?? "up",
        smbSigning: body.smbSigning ?? null,
        isDc: body.isDc ?? false,
        notes: body.notes ?? "",
        segments: body.segments?.length ? {
          create: body.segments.map((s) => ({ segmentId: s.segmentId, ip: s.ip ?? "" })),
        } : undefined,
        ports: body.ports?.length ? {
          create: body.ports.map((p) => ({
            port: p.port, protocol: p.protocol ?? "tcp", service: p.service ?? "",
            version: p.version ?? "", banner: p.banner ?? "",
          })),
        } : undefined,
      },
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
        ports: true,
        routes: { orderBy: [{ isDefault: "desc" }, { destination: "asc" }, { iface: "asc" }] },
      },
    });

    if (body.routes?.length) {
      await upsertHostRoutes({
        hostId: host.id,
        routes: body.routes,
        defaultSource: "host-create",
      });
    }

    const fullHost = await prisma.host.findUnique({
      where: { id: host.id },
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
    return apiSuccess(fullHost ?? host, 201);
  } catch (e) {
    return apiError(e instanceof Error ? e.message : "Unknown error", 500);
  }
}
