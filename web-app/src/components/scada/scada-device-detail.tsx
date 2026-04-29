"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowLeft, Cpu, Database, Radio, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";

interface ScadaRegisterRow {
  id: string;
  registerType: string;
  address: number;
  rawValue: number;
  decodedValue: string;
  hexValue: string;
  isNonZero: boolean;
  lastUpdated: string;
}

interface ScadaDeviceDetailData {
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
  registers: ScadaRegisterRow[];
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

export function ScadaDeviceDetail({ device }: { device: ScadaDeviceDetailData }) {
  const [search, setSearch] = useState("");
  const [registerTypeFilter, setRegisterTypeFilter] = useState("all");
  const [showNonZeroOnly, setShowNonZeroOnly] = useState(false);

  const registerTypeCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of device.registers) {
      map.set(row.registerType, (map.get(row.registerType) ?? 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [device.registers]);

  const filteredRegisters = useMemo(() => {
    const q = search.trim().toLowerCase();
    return device.registers.filter((r) => {
      if (registerTypeFilter !== "all" && r.registerType !== registerTypeFilter) return false;
      if (showNonZeroOnly && !r.isNonZero) return false;
      if (!q) return true;
      const haystack = [
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
  }, [device.registers, registerTypeFilter, showNonZeroOnly, search]);

  const nonZeroCount = device.registers.filter((r) => r.isNonZero).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/scada" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-2xl font-bold font-mono">
          {device.host}:{device.port} (Unit {device.unitId})
        </h1>
        <Badge variant="outline" className="font-mono">{device.protocol}</Badge>
        <Badge variant="outline">{device.deviceType || "unknown"}</Badge>
      </div>

      <Card>
        <CardContent className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4 pt-4">
          <div><span className="text-muted-foreground">Vendor:</span> {device.vendorName || "—"}</div>
          <div><span className="text-muted-foreground">Product:</span> {device.productName || "—"}</div>
          <div><span className="text-muted-foreground">Model:</span> {device.modelName || "—"}</div>
          <div><span className="text-muted-foreground">Revision:</span> {device.revision || "—"}</div>
          <div className="col-span-2 md:col-span-4">
            <span className="text-muted-foreground">Description:</span> {device.description || "—"}
          </div>
          <div className="col-span-2 md:col-span-4 text-xs text-muted-foreground">
            Last Scan: {device.scanTime ? new Date(device.scanTime).toLocaleString() : "—"}
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="registers" className="space-y-4">
        <TabsList variant="line">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="registers">Registers ({device.registers.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <StatCard label="Registers" value={device.registers.length} icon={Database} />
            <StatCard label="Non-zero" value={nonZeroCount} icon={TriangleAlert} color="text-amber-400" />
            <StatCard label="Types" value={registerTypeCounts.length} icon={Radio} />
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">Register Type Distribution</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {registerTypeCounts.map(([name, count]) => {
                const pct = Math.max(6, Math.round((count / Math.max(1, device.registers.length)) * 100));
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
        </TabsContent>

        <TabsContent value="registers" className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search type/address/value/decoded..."
            />
            <Select value={registerTypeFilter} onValueChange={(value) => setRegisterTypeFilter(value ?? "all")}>
              <SelectTrigger>
                <SelectValue placeholder="Register type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {registerTypeCounts.map(([type]) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={showNonZeroOnly} onCheckedChange={(v) => setShowNonZeroOnly(Boolean(v))} />
              Non-zero only
            </label>
            <div className="text-sm text-muted-foreground flex items-center">
              Showing {filteredRegisters.length}
            </div>
          </div>

          <Card>
            <CardContent className="pt-5">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Address</TableHead>
                    <TableHead>Raw</TableHead>
                    <TableHead>Hex</TableHead>
                    <TableHead>Decoded</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Updated</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRegisters.slice(0, 2000).map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-xs">{r.registerType}</TableCell>
                      <TableCell className="font-mono text-xs">{r.address}</TableCell>
                      <TableCell className="font-mono text-xs">{r.rawValue}</TableCell>
                      <TableCell className="font-mono text-xs">{r.hexValue || `0x${r.rawValue.toString(16)}`}</TableCell>
                      <TableCell className="text-xs max-w-[42rem] break-all">{r.decodedValue || "-"}</TableCell>
                      <TableCell>
                        {r.isNonZero ? (
                          <Badge variant="outline" className="text-[10px]">NZ</Badge>
                        ) : (
                          "-"
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {r.lastUpdated ? new Date(r.lastUpdated).toLocaleString() : "-"}
                      </TableCell>
                    </TableRow>
                  ))}
                  {filteredRegisters.length === 0 && (
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
      </Tabs>
    </div>
  );
}
