import { prisma } from "@/lib/prisma";
import type { ImportResult, FullScanData } from "../types";
import { autoAssignSegments } from "@/lib/segment-utils";
import { upsertHostRoutes, type HostRouteInput } from "@/lib/host-routes";

type HostEntry = FullScanData["hosts"][number];

/** Normalize hosts from dict format (keyed by IP) to array format. */
function normalizeHosts(data: unknown): HostEntry[] {
  const obj = data as Record<string, unknown>;
  if (Array.isArray(obj.hosts)) return obj.hosts as HostEntry[];

  // dict format: { hosts: { "10.1.2.10": { status, ports } } }
  if (obj.hosts && typeof obj.hosts === "object") {
    return Object.entries(obj.hosts as Record<string, Record<string, unknown>>).map(
      ([ip, val]) => ({
        ip,
        status: (val.status as string) ?? "up",
        hostname: val.hostname as string | undefined,
        os: val.os as string | undefined,
        os_version: val.os_version as string | undefined,
        smb_signing: val.smb_signing as boolean | undefined,
        is_dc: val.is_dc as boolean | undefined,
        domain: val.domain as string | undefined,
        interfaces: (Array.isArray(val.interfaces) ? val.interfaces : []) as HostEntry["interfaces"],
        routes: (Array.isArray(val.routes) ? val.routes : []) as HostEntry["routes"],
        ports: (Array.isArray(val.ports) ? val.ports : []) as HostEntry["ports"],
      }),
    );
  }
  return [];
}

export async function importFullScan(data: FullScanData): Promise<ImportResult> {
  const result: ImportResult = { format: "full-scan", created: {}, updated: {}, errors: [] };
  let hostsCreated = 0;
  let hostsUpdated = 0;
  let portsCreated = 0;
  let routesCreated = 0;
  let routesUpdated = 0;

  const hosts = normalizeHosts(data);
  for (const h of hosts) {
    try {
      const existing = await prisma.host.findUnique({
        where: { ip: h.ip },
      });

      const routeInputs: HostRouteInput[] = [
        ...(h.routes ?? []).map((route) => ({
          destination: route.destination,
          gateway: route.gateway,
          iface: route.iface,
          srcIp: route.src_ip,
          connectedIp: route.connected_ip,
          metric: route.metric,
          isDefault: route.is_default,
          isConnected: route.is_connected,
          source: route.source ?? "import:full-scan:routes",
          raw: route.raw,
          notes: route.notes,
        })),
        ...(h.interfaces ?? []).map((iface) => ({
          destination: iface.cidr || (iface.ip.includes("/") ? iface.ip : `${iface.ip}/32`),
          iface: iface.name,
          srcIp: iface.ip.split("/")[0] ?? iface.ip,
          connectedIp: iface.ip.split("/")[0] ?? iface.ip,
          isConnected: true,
          source: "import:full-scan:interfaces",
        })),
      ];

      if (existing) {
        await prisma.host.update({
          where: { id: existing.id },
          data: {
            hostname: h.hostname || existing.hostname,
            os: h.os || existing.os,
            osVersion: h.os_version || existing.osVersion,
            status: h.status || existing.status,
            smbSigning: h.smb_signing ?? existing.smbSigning,
            isDc: h.is_dc ?? existing.isDc,
            domain: h.domain || existing.domain,
            scanTime: new Date(),
          },
        });
        hostsUpdated++;

        for (const p of h.ports) {
          await prisma.port.upsert({
            where: { hostId_port_protocol: { hostId: existing.id, port: p.port, protocol: p.protocol ?? "tcp" } },
            update: { state: p.state ?? "open", service: p.service ?? "", version: p.version ?? "", banner: p.banner ?? "" },
            create: {
              hostId: existing.id, port: p.port, protocol: p.protocol ?? "tcp",
              state: p.state ?? "open", service: p.service ?? "", version: p.version ?? "", banner: p.banner ?? "",
            },
          });
          portsCreated++;
        }

        if (routeInputs.length > 0) {
          const routeResult = await upsertHostRoutes({
            hostId: existing.id,
            routes: routeInputs,
            defaultSource: "import:full-scan",
          });
          routesCreated += routeResult.created;
          routesUpdated += routeResult.updated;
        }
      } else {
        const host = await prisma.host.create({
          data: {
            ip: h.ip,
            hostname: h.hostname ?? "", os: h.os ?? "", osVersion: h.os_version ?? "",
            status: h.status ?? "up", smbSigning: h.smb_signing ?? null,
            isDc: h.is_dc ?? false, domain: h.domain ?? "",
            ports: { create: h.ports.map((p) => ({
              port: p.port, protocol: p.protocol ?? "tcp", state: p.state ?? "open",
              service: p.service ?? "", version: p.version ?? "", banner: p.banner ?? "",
            })) },
          },
        });
        hostsCreated++;
        portsCreated += h.ports.length;

        if (routeInputs.length > 0) {
          const routeResult = await upsertHostRoutes({
            hostId: host.id,
            routes: routeInputs,
            defaultSource: "import:full-scan",
          });
          routesCreated += routeResult.created;
          routesUpdated += routeResult.updated;
        }
      }
    } catch (e) {
      result.errors.push(`Host ${h.ip}: ${e instanceof Error ? e.message : "unknown error"}`);
    }
  }

  // Auto-assign imported hosts to segments based on CIDR
  await autoAssignSegments();

  result.created = { hosts: hostsCreated, ports: portsCreated, routes: routesCreated };
  result.updated = { hosts: hostsUpdated, routes: routesUpdated };
  return result;
}
