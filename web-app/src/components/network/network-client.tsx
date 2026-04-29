"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Plus, Trash2, Pencil, Check, X } from "lucide-react";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/fetcher";

interface SegmentOwnerHost {
  id: string;
  ip: string;
  hostname: string;
}
interface Segment {
  id: string;
  name: string;
  cidr: string;
  description: string;
  order: number;
  reachable: boolean;
  scope?: string;
  ownerHost?: SegmentOwnerHost | null;
  _count?: { hostLinks: number };
}
interface PortData { id: string; port: number; protocol: string; service: string; version: string; }
interface HostSegment { id: string; ip: string; segment: Segment; }
interface HostRoute {
  id: string;
  destination: string;
  gateway: string;
  iface: string;
  srcIp: string;
  connectedIp: string;
  isDefault: boolean;
  isConnected: boolean;
}
interface HostRow {
  id: string; ip: string; hostname: string; os: string; osVersion: string;
  domain: string; status: string; smbSigning: boolean | null; isDc: boolean; notes: string;
  segments: HostSegment[];
  ports: PortData[];
  routes: HostRoute[];
}

function segmentScopeLabel(segment: Segment): string {
  return segment.scope === "host-local" ? "host-local" : "global";
}

function segmentOwnerLabel(segment: Segment): string {
  if (segment.scope !== "host-local") return "—";
  return segment.ownerHost?.ip ?? "unknown-host";
}

function segmentDisplayName(segment: Segment): string {
  if (segment.scope === "host-local") {
    return `${segment.name} @ ${segmentOwnerLabel(segment)}`;
  }
  return segment.name;
}

export function NetworkClient({ initialHosts, initialSegments }: {
  initialHosts: HostRow[]; initialSegments: Segment[];
}) {
  const router = useRouter();
  const [hosts, setHosts] = useState(initialHosts);
  const [segments, setSegments] = useState(initialSegments);
  const [filter, setFilter] = useState("all");

  const refreshHosts = useCallback(async () => {
    const data = await apiGet<HostRow[]>("/api/hosts");
    setHosts(data);
  }, []);

  const refreshSegments = useCallback(async () => {
    const data = await apiGet<Segment[]>("/api/segments");
    setSegments(data);
  }, []);

  const filtered = filter === "all" ? hosts :
    filter === "unassigned" ? hosts.filter((h) => h.segments.length === 0) :
    hosts.filter((h) => h.segments.some((s) => s.segment.id === filter));

  const connectedIpsForHost = (host: HostRow) => {
    const ips = host.routes
      .map((route) => route.connectedIp || route.srcIp)
      .filter((ip) => ip.length > 0);
    return [...new Set(ips)];
  };

  const handleDeleteHost = async (hostId: string) => {
    await apiDelete(`/api/hosts/${hostId}`);
    refreshHosts();
  };

  return (
    <Tabs defaultValue="hosts">
      <TabsList variant="line">
        <TabsTrigger value="hosts">Hosts</TabsTrigger>
        <TabsTrigger value="segments">Segments</TabsTrigger>
      </TabsList>

      <TabsContent value="hosts">
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <Select value={filter} onValueChange={(v) => v && setFilter(v)}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Hosts</SelectItem>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {segments.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {segmentDisplayName(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-sm text-muted-foreground">{filtered.length} hosts</span>
            <div className="flex-1" />
            <AddHostDialog segments={segments} onCreated={refreshHosts} />
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>IP</TableHead>
                <TableHead>Hostname</TableHead>
                <TableHead>OS</TableHead>
                <TableHead>Segments</TableHead>
                <TableHead>Ports</TableHead>
                <TableHead>Route IPs</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((h) => {
                const connectedIps = connectedIpsForHost(h);
                return (
                  <TableRow key={h.id} className="cursor-pointer" onClick={() => router.push(`/network/${h.id}`)}>
                    <TableCell className="font-mono text-sm">
                      {h.ip}
                      {h.isDc && <Badge className="ml-1 bg-yellow-600 text-[10px]">DC</Badge>}
                    </TableCell>
                    <TableCell>{h.hostname || "—"}</TableCell>
                    <TableCell className="text-sm">{h.os} {h.osVersion}</TableCell>
                    <TableCell>
                      <div className="flex gap-1 flex-wrap">
                        {h.segments.map((s) => (
                          <Badge key={s.id} variant="outline" className="text-[10px]">
                            {segmentDisplayName(s.segment)}{s.ip ? ` (${s.ip})` : ""}
                          </Badge>
                        ))}
                        {h.segments.length === 0 && <span className="text-xs text-muted-foreground">—</span>}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {h.ports.slice(0, 5).map((p) => p.port).join(", ")}
                      {h.ports.length > 5 && ` +${h.ports.length - 5}`}
                    </TableCell>
                    <TableCell>
                      {connectedIps.length > 0 ? (
                        <div className="flex gap-1 flex-wrap">
                          {connectedIps.slice(0, 3).map((ip) => (
                            <Badge key={ip} variant="outline" className="font-mono text-[10px]">
                              {ip}
                            </Badge>
                          ))}
                          {connectedIps.length > 3 && (
                            <Badge variant="secondary" className="font-mono text-[10px]">
                              +{connectedIps.length - 3}
                            </Badge>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell><Badge variant={h.status === "up" ? "default" : "secondary"}>{h.status}</Badge></TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); handleDeleteHost(h.id); }}>
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {filtered.length === 0 && (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">No hosts</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </TabsContent>

      <TabsContent value="segments">
        <SegmentList segments={segments} onRefresh={refreshSegments} />
      </TabsContent>
    </Tabs>
  );
}

/* ─── Segment List ─── */

function SegmentList({ segments, onRefresh }: { segments: Segment[]; onRefresh: () => void }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const startEdit = (seg: Segment) => {
    setEditingId(seg.id);
    setEditName(seg.name);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName("");
  };

  const saveEdit = async (segId: string) => {
    if (!editName.trim()) return;
    setSaving(true);
    try {
      await apiPatch(`/api/segments/${segId}`, { name: editName.trim() });
      setEditingId(null);
      setEditName("");
      onRefresh();
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent, segId: string) => {
    if (e.key === "Enter") saveEdit(segId);
    if (e.key === "Escape") cancelEdit();
  };

  const deleteSegment = async (seg: Segment) => {
    const confirmed = window.confirm(`Delete segment "${seg.name}"?`);
    if (!confirmed) return;
    setDeletingId(seg.id);
    try {
      await apiDelete(`/api/segments/${seg.id}`);
      if (editingId === seg.id) cancelEdit();
      onRefresh();
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{segments.length} segments</span>
      </div>
      <Table className="table-fixed">
        <TableHeader>
          <TableRow>
            <TableHead className="w-[22%]">Name</TableHead>
            <TableHead className="w-[10%]">Scope</TableHead>
            <TableHead className="w-[12%]">Owner</TableHead>
            <TableHead className="w-[14%]">CIDR</TableHead>
            <TableHead className="w-[24%]">Description</TableHead>
            <TableHead className="w-[6%]">Hosts</TableHead>
            <TableHead className="w-[7%]">Reachable</TableHead>
            <TableHead className="w-[96px]">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {segments.map((seg) => (
            <TableRow key={seg.id}>
              <TableCell className="align-top whitespace-normal break-words">
                {editingId === seg.id ? (
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => handleKeyDown(e, seg.id)}
                    className="h-7 w-full"
                    autoFocus
                    disabled={saving || deletingId === seg.id}
                  />
                ) : (
                  <span className="font-medium">{seg.name}</span>
                )}
              </TableCell>
              <TableCell className="align-top">
                <Badge variant={seg.scope === "host-local" ? "secondary" : "outline"} className="text-[10px]">
                  {segmentScopeLabel(seg)}
                </Badge>
              </TableCell>
              <TableCell className="align-top font-mono text-xs text-muted-foreground whitespace-normal break-all">{segmentOwnerLabel(seg)}</TableCell>
              <TableCell className="align-top font-mono text-sm text-muted-foreground whitespace-normal break-all">{seg.cidr || "—"}</TableCell>
              <TableCell className="align-top text-sm text-muted-foreground whitespace-normal break-words">{seg.description || "—"}</TableCell>
              <TableCell className="align-top text-sm">{seg._count?.hostLinks ?? "—"}</TableCell>
              <TableCell className="align-top">
                {seg.reachable
                  ? <Badge variant="default" className="text-[10px]">Yes</Badge>
                  : <Badge variant="secondary" className="text-[10px]">No</Badge>
                }
              </TableCell>
              <TableCell className="align-top">
                {editingId === seg.id ? (
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => saveEdit(seg.id)} disabled={saving || deletingId === seg.id}>
                      <Check className="h-3.5 w-3.5 text-green-500" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={cancelEdit} disabled={saving || deletingId === seg.id}>
                      <X className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => startEdit(seg)} disabled={deletingId === seg.id}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => deleteSegment(seg)} disabled={deletingId === seg.id}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                )}
              </TableCell>
            </TableRow>
          ))}
          {segments.length === 0 && (
            <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">No segments</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

/* ─── Add Host Dialog ─── */

function AddHostDialog({ segments, onCreated }: { segments: Segment[]; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [ip, setIp] = useState("");
  const [hostname, setHostname] = useState("");
  const [os, setOs] = useState("");
  const [notes, setNotes] = useState("");
  const [selectedSegs, setSelectedSegs] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const selectableSegments = segments.filter((segment) => segment.scope !== "host-local");

  const toggleSeg = (id: string) => {
    setSelectedSegs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ip.trim()) return;
    setLoading(true);
    try {
      await apiPost("/api/hosts", {
        ip: ip.trim(), hostname, os, notes,
        segments: [...selectedSegs].map((sid) => ({ segmentId: sid })),
      });
      setOpen(false);
      setIp(""); setHostname(""); setOs(""); setNotes("");
      setSelectedSegs(new Set());
      onCreated();
    } finally { setLoading(false); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button><Plus className="mr-2 h-4 w-4" />Add Host</Button>} />
      <DialogContent>
        <DialogHeader><DialogTitle>Add Host</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2"><Label>IP *</Label><Input value={ip} onChange={(e) => setIp(e.target.value)} required /></div>
            <div className="space-y-2"><Label>Hostname</Label><Input value={hostname} onChange={(e) => setHostname(e.target.value)} /></div>
          </div>
          <div className="space-y-2"><Label>OS</Label><Input value={os} onChange={(e) => setOs(e.target.value)} /></div>
          {selectableSegments.length > 0 && (
            <div className="space-y-2">
              <Label>Segments</Label>
              <div className="flex flex-wrap gap-3">
                {selectableSegments.map((s) => (
                  <label key={s.id} className="flex items-center gap-1.5 text-sm">
                    <Checkbox checked={selectedSegs.has(s.id)} onCheckedChange={() => toggleSeg(s.id)} />
                    {s.name}
                  </label>
                ))}
              </div>
            </div>
          )}
          <div className="space-y-2"><Label>Notes</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></div>
          <Button type="submit" disabled={loading || !ip.trim()} className="w-full">{loading ? "Adding..." : "Add Host"}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
