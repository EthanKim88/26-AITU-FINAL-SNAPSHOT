"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Cpu,
  Database,
  AlertTriangle,
  Radio,
  Network,
  Factory,
} from "lucide-react";

interface RegisterRow {
  id: string;
  registerType: string;
  address: number;
  rawValue: number;
  decodedValue: string;
  hexValue: string;
  isNonZero: boolean;
}

interface DeviceRow {
  id: string;
  host: string;
  port: number;
  unitId: number;
  protocol: string;
  deviceType: string;
  description: string;
  vendorName: string;
  productCode: string;
  revision: string;
  productName: string;
  modelName: string;
  scanTime: string;
  registers: RegisterRow[];
  _count: { registers: number };
}

interface ProtocolSummaryRow {
  key: string;
  name: string;
  port: number;
  category: "well-covered" | "partial" | "not-covered";
  toolGrade: string;
  deviceCount: number;
  hasLibrary: boolean;
  libraryName: string;
  recommendedLibrary: string;
  hasTemplate: boolean;
  template: string;
  hasNmap: boolean;
  nmap: string;
}

interface ChecklistRow {
  id: string;
  host?: { id: string; ip: string; hostname: string } | null;
  enumStatus: string;
  exploitStatus: string;
  privescStatus: string;
}

interface IcsScadaSummary {
  stats: {
    deviceCount: number;
    registerCount: number;
    nonZeroCount: number;
    protocolCount: number;
    hostCount: number;
    protocolCounts: Record<string, number>;
    deviceTypeCounts: Record<string, number>;
    registerTypeCounts: Record<string, number>;
  };
  devices: DeviceRow[];
  protocols: ProtocolSummaryRow[];
  checklists: ChecklistRow[];
}

function StatCard({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: number | string;
  icon: typeof Cpu;
  color?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className={`text-xl font-semibold ${color ?? ""}`}>{value}</p>
          </div>
          <Icon className="size-4 text-muted-foreground" />
        </div>
      </CardContent>
    </Card>
  );
}

function gradeColor(grade: string): string {
  if (grade === "A+" || grade === "A" || grade === "A-") return "bg-emerald-500/20 text-emerald-400";
  if (grade === "B-" || grade === "B") return "bg-amber-500/20 text-amber-400";
  if (grade === "C") return "bg-orange-500/20 text-orange-400";
  return "bg-zinc-500/20 text-zinc-400";
}

function checklistDoneCount(c: ChecklistRow): number {
  const statuses = [c.enumStatus, c.exploitStatus, c.privescStatus];
  return statuses.filter((s) => s === "done").length;
}

export function ScadaDashboardClient({ initialSummary }: { initialSummary: IcsScadaSummary }) {
  const [summary] = useState(initialSummary);
  const [deviceSearch, setDeviceSearch] = useState("");
  const [protocolFilter, setProtocolFilter] = useState("all");
  const [registerTypeFilter, setRegisterTypeFilter] = useState("all");
  const [registerSearch, setRegisterSearch] = useState("");
  const [showNonZeroOnly, setShowNonZeroOnly] = useState(false);

  const filteredDevices = useMemo(() => {
    const q = deviceSearch.trim().toLowerCase();
    return summary.devices.filter((d) => {
      if (protocolFilter !== "all" && d.protocol !== protocolFilter) return false;
      if (!q) return true;
      const haystack = [
        d.host,
        String(d.port),
        d.protocol,
        d.deviceType,
        d.vendorName,
        d.productName,
        d.modelName,
        d.description,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [summary.devices, protocolFilter, deviceSearch]);

  const registerRows = useMemo(() => {
    const q = registerSearch.trim().toLowerCase();
    const rows = filteredDevices.flatMap((d) =>
      d.registers.map((r) => ({
        ...r,
        host: d.host,
        port: d.port,
        unitId: d.unitId,
        protocol: d.protocol,
      }))
    );

    return rows.filter((r) => {
      if (registerTypeFilter !== "all" && r.registerType !== registerTypeFilter) return false;
      if (showNonZeroOnly && !r.isNonZero) return false;
      if (!q) return true;
      const haystack = [
        r.host,
        String(r.port),
        r.protocol,
        r.registerType,
        String(r.address),
        String(r.rawValue),
        r.hexValue,
        r.decodedValue,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [filteredDevices, registerTypeFilter, showNonZeroOnly, registerSearch]);

  const protocolDistribution = Object.entries(summary.stats.protocolCounts);
  const deviceTypeDistribution = Object.entries(summary.stats.deviceTypeCounts);
  const registerTypeOptions = Object.keys(summary.stats.registerTypeCounts);

  if (summary.devices.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground space-y-2">
        <Factory className="size-10 mx-auto opacity-30" />
        <p>No SCADA devices yet</p>
        <p className="text-sm">Import SCADA data first (`protocol-detect`, `scada-template`, `modbus-scanner`, `modbus-rw`).</p>
      </div>
    );
  }

  return (
    <Tabs defaultValue="overview" className="space-y-4">
      <TabsList variant="line">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="devices">Devices ({summary.stats.deviceCount})</TabsTrigger>
        <TabsTrigger value="registers">Registers ({summary.stats.registerCount})</TabsTrigger>
        <TabsTrigger value="protocols">Protocols ({summary.protocols.length})</TabsTrigger>
      </TabsList>

      <TabsContent value="overview" className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <StatCard label="Devices" value={summary.stats.deviceCount} icon={Cpu} />
          <StatCard label="Registers" value={summary.stats.registerCount} icon={Database} />
          <StatCard label="Non-zero" value={summary.stats.nonZeroCount} icon={AlertTriangle} color="text-amber-400" />
          <StatCard label="Protocols" value={summary.stats.protocolCount} icon={Radio} />
          <StatCard label="Hosts" value={summary.stats.hostCount} icon={Network} />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">Protocol Distribution</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {protocolDistribution.map(([name, count]) => {
                const pct = Math.max(6, Math.round((count / Math.max(1, summary.stats.deviceCount)) * 100));
                return (
                  <div key={name} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-mono">{name}</span>
                      <span>{count}</span>
                    </div>
                    <div className="h-2 rounded bg-zinc-800">
                      <div className="h-2 rounded bg-sky-500/70" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">Device Types</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {deviceTypeDistribution.map(([name, count]) => {
                const pct = Math.max(6, Math.round((count / Math.max(1, summary.stats.deviceCount)) * 100));
                return (
                  <div key={name} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-mono">{name}</span>
                      <span>{count}</span>
                    </div>
                    <div className="h-2 rounded bg-zinc-800">
                      <div className="h-2 rounded bg-teal-500/70" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Attack Progress</CardTitle>
          </CardHeader>
          <CardContent>
            {summary.checklists.length === 0 ? (
              <p className="text-sm text-muted-foreground">No checklist data yet</p>
            ) : (
              <div className="space-y-2">
                {summary.checklists.slice(0, 8).map((c) => {
                  const done = checklistDoneCount(c);
                  const pct = Math.round((done / 3) * 100);
                  return (
                    <div key={c.id} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-mono">{c.host?.ip ?? "unknown host"}</span>
                        <span>{done}/3</span>
                      </div>
                      <div className="h-2 rounded bg-zinc-800">
                        <div className="h-2 rounded bg-emerald-500/70" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="devices" className="space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
          <Input
            value={deviceSearch}
            onChange={(e) => setDeviceSearch(e.target.value)}
            placeholder="Search host/protocol/vendor/model..."
          />
          <Select value={protocolFilter} onValueChange={(value) => setProtocolFilter(value ?? "all")}>
            <SelectTrigger>
              <SelectValue placeholder="Protocol" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Protocols</SelectItem>
              {Object.keys(summary.stats.protocolCounts).map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="text-sm text-muted-foreground flex items-center">Showing {filteredDevices.length} devices</div>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Device List</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Device</TableHead>
                  <TableHead>Protocol</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Registers</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead className="text-right">Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredDevices.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-mono text-xs">
                      {d.host}:{d.port} (U{d.unitId})
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-mono">
                        {d.protocol}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">{d.deviceType || "-"}</TableCell>
                    <TableCell className="text-xs">{d._count.registers}</TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-72 truncate">{d.description || "-"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {d.scanTime ? new Date(d.scanTime).toLocaleString() : "-"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link href={`/scada/devices/${d.id}`} className="text-xs underline underline-offset-2 hover:text-foreground">
                        Open
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
                {filteredDevices.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground">
                      No matching devices
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="registers" className="space-y-4">
        <div className="grid gap-3 md:grid-cols-4">
          <Input
            value={registerSearch}
            onChange={(e) => setRegisterSearch(e.target.value)}
            placeholder="Search host/type/address/value..."
          />
          <Select value={registerTypeFilter} onValueChange={(value) => setRegisterTypeFilter(value ?? "all")}>
            <SelectTrigger>
              <SelectValue placeholder="Register type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              {registerTypeOptions.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={showNonZeroOnly} onCheckedChange={(v) => setShowNonZeroOnly(Boolean(v))} />
            Non-zero only
          </label>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              Register View ({registerRows.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Host</TableHead>
                  <TableHead>Proto</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Addr</TableHead>
                  <TableHead>Raw</TableHead>
                  <TableHead>Hex</TableHead>
                  <TableHead>Decoded</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {registerRows.slice(0, 500).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">
                      {r.host}:{r.port}
                    </TableCell>
                    <TableCell className="text-xs">{r.protocol}</TableCell>
                    <TableCell className="text-xs">{r.registerType}</TableCell>
                    <TableCell className="font-mono text-xs">{r.address}</TableCell>
                    <TableCell className="font-mono text-xs">{r.rawValue}</TableCell>
                    <TableCell className="font-mono text-xs">{r.hexValue || `0x${r.rawValue.toString(16)}`}</TableCell>
                    <TableCell className="text-xs">{r.decodedValue || "-"}</TableCell>
                  </TableRow>
                ))}
                {registerRows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground">
                      No matching registers
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="protocols" className="space-y-3">
        {summary.protocols
          .slice()
          .sort((a, b) => b.deviceCount - a.deviceCount || a.name.localeCompare(b.name))
          .map((p) => (
            <Card key={p.key}>
              <CardContent className="pt-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold">{p.name}</p>
                    <p className="text-xs text-muted-foreground">
                      key={p.key} · port={p.port || "-"} · devices={p.deviceCount}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Badge className={gradeColor(p.toolGrade)}>{p.toolGrade}</Badge>
                    <Badge variant={p.hasLibrary ? "default" : "outline"}>
                      lib: {p.hasLibrary ? "yes" : "no"}
                    </Badge>
                    <Badge variant={p.hasTemplate ? "default" : "outline"}>
                      tpl: {p.hasTemplate ? "yes" : "no"}
                    </Badge>
                  </div>
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  {p.libraryName && <span>library={p.libraryName}</span>}
                  {p.recommendedLibrary && <span> · recommended={p.recommendedLibrary}</span>}
                  {p.template && <span> · template={p.template}</span>}
                  {p.nmap && <span> · nmap={p.nmap}</span>}
                </div>
              </CardContent>
            </Card>
          ))}
      </TabsContent>
    </Tabs>
  );
}
