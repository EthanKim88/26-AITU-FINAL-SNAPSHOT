"use client";

import Link from "next/link";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft } from "lucide-react";

interface SegmentOwnerHost { id: string; ip: string; hostname: string; }
interface Segment { id: string; name: string; cidr: string; scope?: string; ownerHost?: SegmentOwnerHost | null; }
interface HostSegment { id: string; ip: string; segment: Segment; }
interface PortData { id: string; port: number; state: string; protocol: string; service: string; version: string; banner: string; }
interface CredentialAccess {
  id: string; protocol: string; status: string; isAdmin: boolean; testedAt: string | null; notes: string;
  credential: { id: string; username: string; secret: string; secretType: string; credType: string; domain: string; linkedService: string; source: string; };
}
interface ChecklistData {
  id: string; hostIp: string;
  enumStatus: string; exploitStatus: string; privescStatus: string;
  enumStartedAt: string | null; enumCompletedAt: string | null;
  exploitStartedAt: string | null; exploitCompletedAt: string | null;
  privescStartedAt: string | null; privescCompletedAt: string | null;
  notes: string;
}
interface PivotRouteData {
  id: string; protocol: string; port: number; status: string; notes: string;
  fromSegment: Segment;
  toSegment: Segment;
  credential: { username: string; domain: string; } | null;
}
interface HostRouteData {
  id: string;
  destination: string;
  gateway: string;
  iface: string;
  srcIp: string;
  connectedIp: string;
  metric: number | null;
  isDefault: boolean;
  isConnected: boolean;
  source: string;
  notes: string;
}

interface HostData {
  id: string; ip: string; hostname: string; os: string; osVersion: string;
  domain: string; status: string; smbSigning: boolean | null; isDc: boolean; notes: string;
  segments: HostSegment[];
  ports: PortData[];
  routes: HostRouteData[];
  accesses: CredentialAccess[];
  checklists: ChecklistData[];
  pivotRoutes: PivotRouteData[];
}

function statusBadge(status: string) {
  const variant = status === "valid" || status === "done" ? "default"
    : status === "invalid" || status === "skipped" ? "secondary"
    : status === "in-progress" ? "outline"
    : "secondary";
  return <Badge variant={variant} className="text-[10px]">{status}</Badge>;
}

function segmentDisplayName(segment: Segment): string {
  if (segment.scope === "host-local") {
    return `${segment.name} @ ${segment.ownerHost?.ip ?? "unknown-host"}`;
  }
  return segment.name;
}

export function HostDetail({ host }: { host: HostData }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/network" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-2xl font-bold font-mono">{host.ip}</h1>
        {host.hostname && <span className="text-lg text-muted-foreground">{host.hostname}</span>}
        <Badge variant={host.status === "up" ? "default" : "secondary"}>{host.status}</Badge>
        {host.isDc && <Badge className="bg-yellow-600 text-[10px]">DC</Badge>}
      </div>

      <Card>
        <CardContent className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4 pt-4">
          <div><span className="text-muted-foreground">OS:</span> {host.os} {host.osVersion || ""}</div>
          <div><span className="text-muted-foreground">Domain:</span> {host.domain || "—"}</div>
          <div><span className="text-muted-foreground">SMB Signing:</span> {host.smbSigning === null ? "—" : host.smbSigning ? "Required" : "Not Required"}</div>
          <div>
            <span className="text-muted-foreground">Segments:</span>{" "}
            {host.segments.length > 0
              ? host.segments.map((s) => segmentDisplayName(s.segment)).join(", ")
              : "—"}
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="ports">
        <TabsList>
          <TabsTrigger value="ports">Ports ({host.ports.length})</TabsTrigger>
          <TabsTrigger value="routes">Routes ({host.routes.length})</TabsTrigger>
          <TabsTrigger value="access">Access ({host.accesses.length})</TabsTrigger>
          <TabsTrigger value="checklist">Checklist ({host.checklists.length})</TabsTrigger>
          <TabsTrigger value="info">Info</TabsTrigger>
        </TabsList>

        <TabsContent value="ports">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Port</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Service</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Banner</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {host.ports.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-mono text-sm">{p.port}/{p.protocol}</TableCell>
                  <TableCell><Badge variant={p.state === "open" ? "default" : "secondary"} className="text-[10px]">{p.state}</Badge></TableCell>
                  <TableCell>{p.service || "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-48 truncate">{p.version || "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-48 truncate">{p.banner || "—"}</TableCell>
                </TableRow>
              ))}
              {host.ports.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No ports scanned</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </TabsContent>

        <TabsContent value="routes">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Connected IP</TableHead>
                <TableHead>Destination</TableHead>
                <TableHead>Gateway</TableHead>
                <TableHead>Interface</TableHead>
                <TableHead>Route Meta</TableHead>
                <TableHead>Source</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {host.routes.map((route) => (
                <TableRow key={route.id}>
                  <TableCell className="font-mono text-xs">{route.connectedIp || route.srcIp || "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{route.destination}</TableCell>
                  <TableCell className="font-mono text-xs">{route.gateway || "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{route.iface || "—"}</TableCell>
                  <TableCell>
                    <div className="flex gap-1 flex-wrap">
                      {route.isDefault && <Badge className="text-[10px]">default</Badge>}
                      {route.isConnected && <Badge variant="outline" className="text-[10px]">connected</Badge>}
                      {route.metric !== null && <Badge variant="secondary" className="font-mono text-[10px]">metric:{route.metric}</Badge>}
                      {!route.isDefault && !route.isConnected && route.metric === null && "—"}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-40 truncate">{route.source || "—"}</TableCell>
                </TableRow>
              ))}
              {host.routes.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No route data</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </TabsContent>

        <TabsContent value="access">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Credential</TableHead>
                <TableHead>Protocol</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Admin</TableHead>
                <TableHead>Tested</TableHead>
                <TableHead>Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {host.accesses.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-mono text-sm">
                    {a.credential.domain ? `${a.credential.domain}\\` : ""}{a.credential.username}
                    <span className="text-muted-foreground ml-1 text-xs">({a.credential.credType})</span>
                  </TableCell>
                  <TableCell className="text-sm">{a.protocol}</TableCell>
                  <TableCell>{statusBadge(a.status)}</TableCell>
                  <TableCell>{a.isAdmin ? <Badge className="bg-red-600 text-[10px]">ADMIN</Badge> : "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{a.testedAt ? new Date(a.testedAt).toLocaleString() : "—"}</TableCell>
                  <TableCell className="text-xs max-w-32 truncate">{a.notes || "—"}</TableCell>
                </TableRow>
              ))}
              {host.accesses.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No credential access records</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </TabsContent>

        <TabsContent value="checklist">
          {host.checklists.length > 0 ? (
            <div className="grid gap-3">
              {host.checklists.map((cl) => (
                <Card key={cl.id}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Attack Checklist</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                      {(["enum", "exploit", "privesc"] as const).map((phase) => {
                        const status = cl[`${phase}Status`];
                        const started = cl[`${phase}StartedAt`];
                        const completed = cl[`${phase}CompletedAt`];
                        return (
                          <div key={phase} className="space-y-1 rounded-md border p-3">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium capitalize">{phase}</span>
                              {statusBadge(status)}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {started ? `Started: ${new Date(started).toLocaleString()}` : "Not started"}
                            </div>
                            {completed && (
                              <div className="text-xs text-muted-foreground">
                                Done: {new Date(completed).toLocaleString()}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {cl.notes && <p className="mt-3 text-sm text-muted-foreground">{cl.notes}</p>}
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <p className="text-center text-muted-foreground py-8">No attack checklist</p>
          )}
        </TabsContent>

        <TabsContent value="info" className="space-y-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Notes</CardTitle></CardHeader>
            <CardContent>
              <pre className="whitespace-pre-wrap text-sm">{host.notes || "No notes"}</pre>
            </CardContent>
          </Card>

          {host.pivotRoutes.length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Pivot Routes</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>From</TableHead>
                      <TableHead>To</TableHead>
                      <TableHead>Protocol</TableHead>
                      <TableHead>Port</TableHead>
                      <TableHead>Credential</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {host.pivotRoutes.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="text-sm">{segmentDisplayName(r.fromSegment)}</TableCell>
                        <TableCell className="text-sm">{segmentDisplayName(r.toSegment)}</TableCell>
                        <TableCell className="text-sm">{r.protocol}</TableCell>
                        <TableCell className="font-mono text-sm">{r.port}</TableCell>
                        <TableCell className="font-mono text-xs">
                          {r.credential ? `${r.credential.domain ? `${r.credential.domain}\\` : ""}${r.credential.username}` : "—"}
                        </TableCell>
                        <TableCell>{statusBadge(r.status)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
