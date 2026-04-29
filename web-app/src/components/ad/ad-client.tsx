"use client";

import { useState, useCallback, useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { apiGet } from "@/lib/fetcher";
import {
  Shield, Server, Key, Users, CheckCircle2, Circle,
  Monitor, ChevronDown, ChevronRight, AlertTriangle, Lock, Unlock,
  Copy, Check,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────

interface AdDomainSummary {
  id: string; domainName: string; dcIp: string; functionalLevel: string;
  forestLevel: string; dnsHostname: string; serverName: string;
  passwordPolicy: string; attackRecommendations: string;
  _count: { users: number; groups: number; computers: number; trusts: number; gpos: number };
}

interface AdDomainDetail {
  id: string; domainName: string; dcIp: string; functionalLevel: string;
  forestLevel: string; dcLevel: string; dnsHostname: string; serverName: string;
  passwordPolicy: string; smbShares: string; attackRecommendations: string; errors: string;
  users: AdUser[];
  groups: { id: string; name: string; description: string; members: string; memberCount: number; groupType: string }[];
  computers: { id: string; name: string; dnsHostname: string; os: string; osVersion: string; isDc: boolean; unconstrainedDelegation: boolean; constrainedDelegation: string; rbcd: boolean }[];
  trusts: { id: string; name: string; direction: string; trustType: string }[];
  gpos: { id: string; displayName: string; name: string; path: string }[];
}

interface AdUser {
  id: string; username: string; description: string; groups: string; spn: string;
  kerberoastable: boolean; asrepRoastable: boolean; adminCount: boolean;
  lastLogon: string; pwdLastSet: string; constrainedDelegationTargets: string; email: string;
}

interface PortRow { port: number; protocol: string; service: string; state: string }
interface SessionRef { id: number; title: string; status: string }
interface CredRef { id: string; username: string; domain: string; credType: string; secretType: string }

interface ChecklistRow {
  id: string; hostIp: string; notes: string;
  enumStatus: string; exploitStatus: string; privescStatus: string;
  enumStartedAt: string | null; enumCompletedAt: string | null;
  exploitStartedAt: string | null; exploitCompletedAt: string | null;
  privescStartedAt: string | null; privescCompletedAt: string | null;
  sessionId: number | null;
  host?: { id: string; ip: string; hostname: string; os: string; domain: string; isDc: boolean } | null;
  session?: SessionRef | null;
}

interface AccessRow {
  id: string; protocol: string; status: string; isAdmin: boolean;
  host: { id: string; ip: string; hostname: string };
}

interface CredRow {
  id: string; username: string; secret: string; secretType: string;
  credType: string; domain: string; source: string; notes: string;
  accesses: AccessRow[];
}

interface HostAccessRow {
  id: string; protocol: string; port: number | null; status: string; isAdmin: boolean;
  credential: CredRef;
}

interface AdHost {
  id: string; ip: string; hostname: string; os: string; domain: string; isDc: boolean; notes: string;
  ports: PortRow[];
  checklists: (ChecklistRow & { session?: SessionRef | null })[];
  accesses: HostAccessRow[];
}

// ─── Helpers ────────────────────────────────────────────

function tryParse<T>(json: string, fallback: T): T {
  try { return JSON.parse(json); } catch { return fallback; }
}

const stepStatusIcon: Record<string, { icon: typeof CheckCircle2; color: string }> = {
  "done": { icon: CheckCircle2, color: "text-green-500" },
  "in-progress": { icon: Circle, color: "text-amber-500 animate-pulse" },
  "skipped": { icon: Circle, color: "text-zinc-600 line-through" },
  "pending": { icon: Circle, color: "text-zinc-700" },
};

function StepBadge({ status, label }: { status: string; label: string }) {
  const s = stepStatusIcon[status] || stepStatusIcon.pending;
  const Icon = s.icon;
  return (
    <div className="flex items-center gap-1">
      <Icon className={`size-3.5 ${s.color}`} />
      <span className={`text-xs ${status === "done" ? "text-green-400" : status === "in-progress" ? "text-amber-400" : "text-zinc-500"}`}>
        {label}
      </span>
    </div>
  );
}

function statusBadge(status: string, isAdmin: boolean) {
  if (status === "valid" && isAdmin) return <Badge className="bg-red-600 text-[10px]">ADMIN</Badge>;
  if (status === "valid") return <Badge className="bg-green-600 text-[10px]">VALID</Badge>;
  if (status === "invalid") return <Badge variant="outline" className="text-[10px] text-zinc-500">invalid</Badge>;
  return <Badge variant="outline" className="text-[10px] text-zinc-600">?</Badge>;
}

// ─── Component ──────────────────────────────────────────

export function AdClient({
  initialDomains,
  initialAdHosts,
  initialDomainCreds,
  initialChecklists,
}: {
  initialDomains: AdDomainSummary[];
  initialAdHosts: AdHost[];
  initialDomainCreds: CredRow[];
  initialChecklists: ChecklistRow[];
}) {
  const [domains] = useState(initialDomains);
  const [adHosts] = useState(initialAdHosts);
  const [domainCreds] = useState(initialDomainCreds);
  const [checklists] = useState(initialChecklists);

  // Domain enum detail (loaded on demand)
  const [selectedDomainId, setSelectedDomainId] = useState(domains[0]?.id ?? "");
  const [detail, setDetail] = useState<AdDomainDetail | null>(null);
  const [filterKerb, setFilterKerb] = useState(false);
  const [filterAsrep, setFilterAsrep] = useState(false);
  const [filterAdmin, setFilterAdmin] = useState(false);
  const [expandedHost, setExpandedHost] = useState<string | null>(null);
  const [expandedCred, setExpandedCred] = useState<string | null>(null);
  const [copiedCred, setCopiedCred] = useState<string | null>(null);

  const loadDetail = useCallback(async (domainId: string) => {
    if (!domainId) return;
    const d = await apiGet<AdDomainDetail>(`/api/ad/${domainId}`);
    setDetail(d);
  }, []);

  useEffect(() => {
    if (selectedDomainId) loadDetail(selectedDomainId);
  }, [selectedDomainId, loadDetail]);

  const hasAdEnum = domains.length > 0;
  const hasAnyData = adHosts.length > 0 || domainCreds.length > 0 || hasAdEnum;

  if (!hasAnyData) {
    return (
      <div className="text-center py-12 text-muted-foreground space-y-2">
        <Shield className="size-10 mx-auto opacity-30" />
        <p>No AD data yet</p>
        <p className="text-sm">AD data will appear here once AD hosts are discovered or AD enumeration data is imported.</p>
      </div>
    );
  }

  // Compute stats
  const validAccesses = domainCreds.flatMap(c => c.accesses.filter(a => a.status === "valid"));
  const adminAccesses = validAccesses.filter(a => a.isAdmin);
  const totalUsers = domains.reduce((s, d) => s + d._count.users, 0);

  // Filter users in detail
  const filteredUsers = detail?.users.filter(u => {
    if (filterKerb && !u.kerberoastable) return false;
    if (filterAsrep && !u.asrepRoastable) return false;
    if (filterAdmin && !u.adminCount) return false;
    return true;
  }) ?? [];

  const recommendations = detail ? tryParse<{ action?: string; reason?: string; priority?: string }[]>(detail.attackRecommendations, []) : [];

  return (
    <Tabs defaultValue="overview" className="space-y-4">
      <TabsList variant="line">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="hosts">Hosts ({adHosts.length})</TabsTrigger>
        <TabsTrigger value="credentials">Creds ({domainCreds.length})</TabsTrigger>
        {hasAdEnum && <TabsTrigger value="enum">Enum ({totalUsers} users)</TabsTrigger>}
      </TabsList>

      {/* ═══════════════════ OVERVIEW ═══════════════════ */}
      <TabsContent value="overview" className="space-y-4">
        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <StatCard icon={Server} label="AD Hosts" value={adHosts.length} />
          <StatCard icon={Key} label="Domain Creds" value={domainCreds.length} />
          <StatCard icon={Unlock} label="Valid Access" value={validAccesses.length} color={validAccesses.length > 0 ? "text-green-400" : undefined} />
          <StatCard icon={Lock} label="Admin Access" value={adminAccesses.length} color={adminAccesses.length > 0 ? "text-red-400" : undefined} />
          <StatCard icon={Users} label="AD Users" value={totalUsers} />
        </div>

        {/* Domain info */}
        {domains.map(d => {
          const policy = tryParse<Record<string, unknown>>(d.passwordPolicy, {});
          return (
            <Card key={d.id}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Shield className="size-4 text-blue-400" />
                  {d.domainName}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
                  <div><span className="text-muted-foreground">DC IP:</span> <span className="font-mono">{d.dcIp || "-"}</span></div>
                  <div><span className="text-muted-foreground">Functional:</span> {d.functionalLevel || "-"}</div>
                  <div><span className="text-muted-foreground">DNS:</span> <span className="font-mono">{d.dnsHostname || "-"}</span></div>
                  <div><span className="text-muted-foreground">Server:</span> <span className="font-mono">{d.serverName || "-"}</span></div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="outline">{d._count.users} users</Badge>
                  <Badge variant="outline">{d._count.groups} groups</Badge>
                  <Badge variant="outline">{d._count.computers} computers</Badge>
                  <Badge variant="outline">{d._count.trusts} trusts</Badge>
                  <Badge variant="outline">{d._count.gpos} GPOs</Badge>
                </div>
                {Object.keys(policy).length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground font-medium mb-1">Password Policy</p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-xs">
                      {Object.entries(policy).map(([k, v]) => (
                        <div key={k}><span className="text-muted-foreground">{k}:</span> <span className="font-mono">{String(v)}</span></div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}

        {/* Attack Progress */}
        {checklists.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">Attack Progress</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-32">Host</TableHead>
                    <TableHead>Domain</TableHead>
                    <TableHead>Enum</TableHead>
                    <TableHead>Exploit</TableHead>
                    <TableHead>Privesc</TableHead>
                    <TableHead>Session</TableHead>
                    <TableHead className="text-right">Progress</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {checklists.map(cl => {
                    const steps = [cl.enumStatus, cl.exploitStatus, cl.privescStatus];
                    const done = steps.filter(s => s === "done").length;
                    const pct = Math.round((done / 3) * 100);
                    return (
                      <TableRow key={cl.id}>
                        <TableCell className="font-mono text-sm">
                          {cl.host?.ip || cl.hostIp}
                          {cl.host?.isDc && <Badge className="ml-1 bg-blue-600 text-[10px]">DC</Badge>}
                        </TableCell>
                        <TableCell className="text-sm">{cl.host?.domain || "-"}</TableCell>
                        <TableCell><StepBadge status={cl.enumStatus} label="Enum" /></TableCell>
                        <TableCell><StepBadge status={cl.exploitStatus} label="Exploit" /></TableCell>
                        <TableCell><StepBadge status={cl.privescStatus} label="Privesc" /></TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {cl.session ? `#${cl.session.id}` : "-"}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-16 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${pct === 100 ? "bg-green-500" : pct > 0 ? "bg-amber-500" : "bg-zinc-700"}`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="text-xs text-muted-foreground w-8">{pct}%</span>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* Recommendations */}
        {recommendations.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground flex items-center gap-1.5">
                <AlertTriangle className="size-3.5" /> Attack Recommendations
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {recommendations.map((r, i) => (
                <div key={i} className="flex items-start gap-2 border-l-2 border-amber-500/30 pl-3 py-1">
                  {r.priority && (
                    <Badge variant={r.priority === "high" ? "destructive" : "secondary"} className="text-[10px] shrink-0">
                      {r.priority}
                    </Badge>
                  )}
                  <div>
                    <p className="text-sm font-medium">{r.action}</p>
                    {r.reason && <p className="text-xs text-muted-foreground">{r.reason}</p>}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </TabsContent>

      {/* ═══════════════════ HOSTS ═══════════════════ */}
      <TabsContent value="hosts" className="space-y-3">
        {adHosts.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">No AD hosts discovered yet.</p>
        ) : (
          adHosts.map(host => {
            const isExpanded = expandedHost === host.id;
            const cl = host.checklists[0];
            const validHostAccess = host.accesses.filter(a => a.status === "valid");
            const adminHostAccess = validHostAccess.filter(a => a.isAdmin);
            return (
              <Card key={host.id}>
                <CardContent className="py-3">
                  <button
                    onClick={() => setExpandedHost(isExpanded ? null : host.id)}
                    className="flex items-center gap-3 w-full text-left"
                  >
                    {isExpanded ? <ChevronDown className="size-4 text-zinc-500" /> : <ChevronRight className="size-4 text-zinc-500" />}
                    <Monitor className="size-4 text-zinc-400" />
                    <span className="font-mono font-medium">{host.ip}</span>
                    {host.hostname && <span className="text-sm text-muted-foreground">{host.hostname}</span>}
                    {host.isDc && <Badge className="bg-blue-600 text-[10px]">DC</Badge>}
                    {host.domain && <Badge variant="outline" className="text-[10px]">{host.domain}</Badge>}
                    {host.os && <span className="text-xs text-muted-foreground">{host.os}</span>}
                    <div className="ml-auto flex items-center gap-2 shrink-0">
                      {adminHostAccess.length > 0 && <Badge className="bg-red-600 text-[10px]">{adminHostAccess.length} admin</Badge>}
                      {validHostAccess.length > 0 && adminHostAccess.length === 0 && <Badge className="bg-green-600 text-[10px]">{validHostAccess.length} valid</Badge>}
                      <span className="text-xs text-muted-foreground">{host.ports.length} ports</span>
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="mt-3 space-y-3 pl-9">
                      {/* Checklist progress */}
                      {cl && (
                        <div className="flex items-center gap-4 bg-zinc-900 rounded p-2">
                          <StepBadge status={cl.enumStatus} label="Enum" />
                          <StepBadge status={cl.exploitStatus} label="Exploit" />
                          <StepBadge status={cl.privescStatus} label="Privesc" />
                          {cl.session && <span className="text-xs text-muted-foreground ml-auto">Session #{cl.session.id}: {cl.session.title}</span>}
                        </div>
                      )}

                      {/* Ports */}
                      {host.ports.length > 0 && (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-24">Port</TableHead>
                              <TableHead>Service</TableHead>
                              <TableHead>State</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {host.ports.map(p => (
                              <TableRow key={`${p.port}-${p.protocol}`}>
                                <TableCell className="font-mono text-sm">{p.port}/{p.protocol}</TableCell>
                                <TableCell className="text-sm">{p.service || "-"}</TableCell>
                                <TableCell>
                                  <Badge className={`text-[10px] ${p.state === "open" ? "bg-green-600" : "bg-zinc-600"}`}>
                                    {p.state}
                                  </Badge>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}

                      {/* Credential access on this host */}
                      {host.accesses.length > 0 && (
                        <div>
                          <p className="text-xs text-muted-foreground font-medium mb-1">Credential Access</p>
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Username</TableHead>
                                <TableHead>Domain</TableHead>
                                <TableHead>Protocol</TableHead>
                                <TableHead>Status</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {host.accesses.map(a => (
                                <TableRow key={a.id}>
                                  <TableCell className="font-mono text-sm">{a.credential.username}</TableCell>
                                  <TableCell className="text-sm">{a.credential.domain || "-"}</TableCell>
                                  <TableCell><Badge variant="outline" className="text-[10px]">{a.protocol}</Badge></TableCell>
                                  <TableCell>{statusBadge(a.status, a.isAdmin)}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      )}

                      {host.notes && <p className="text-xs text-muted-foreground">{host.notes}</p>}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })
        )}
      </TabsContent>

      {/* ═══════════════════ CREDENTIALS ═══════════════════ */}
      <TabsContent value="credentials" className="space-y-3">
        {domainCreds.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">No domain credentials discovered yet.</p>
        ) : (
          <>
            <Table className="table-fixed w-full">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[14%]">Username</TableHead>
                  <TableHead className="w-[36%]">Secret</TableHead>
                  <TableHead className="w-[12%]">Domain</TableHead>
                  <TableHead className="w-[8%]">Type</TableHead>
                  <TableHead className="w-[12%]">Source</TableHead>
                  <TableHead className="w-[18%]">Access Summary</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {domainCreds.map(cred => {
                  const valid = cred.accesses.filter(a => a.status === "valid");
                  const admins = cred.accesses.filter(a => a.isAdmin);
                  const invalid = cred.accesses.filter(a => a.status === "invalid");
                  const untested = cred.accesses.filter(a => a.status === "untested");
                  const isExpanded = expandedCred === cred.id;

                  return (
                    <TableRow
                      key={cred.id}
                      className="cursor-pointer"
                      onClick={() => setExpandedCred(isExpanded ? null : cred.id)}
                    >
                      <TableCell className="font-mono font-medium">{cred.username}</TableCell>
                      <TableCell className="font-mono text-sm text-muted-foreground break-all whitespace-normal">
                        <div className="flex items-start gap-1">
                          <span className="break-all">{cred.secret || "-"}</span>
                          {cred.secret && (
                            <button
                              type="button"
                              className="shrink-0 p-0.5 rounded hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300 transition-colors"
                              onClick={(e) => {
                                e.stopPropagation();
                                navigator.clipboard.writeText(cred.secret);
                                setCopiedCred(cred.id);
                                setTimeout(() => setCopiedCred(null), 1500);
                              }}
                              title="Copy"
                            >
                              {copiedCred === cred.id ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                            </button>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-sm">{cred.domain || "-"}</TableCell>
                      <TableCell className="text-sm">{cred.secretType}</TableCell>
                      <TableCell className="text-sm truncate overflow-hidden">{cred.source || "-"}</TableCell>
                      <TableCell>
                        <div className="flex gap-1 flex-wrap">
                          {valid.length > 0 && <Badge className="bg-green-600 text-[10px]">{valid.length} valid</Badge>}
                          {admins.length > 0 && <Badge className="bg-red-600 text-[10px]">{admins.length} admin</Badge>}
                          {invalid.length > 0 && <Badge variant="outline" className="text-[10px] text-zinc-500">{invalid.length} inv</Badge>}
                          {untested.length > 0 && <Badge variant="outline" className="text-[10px] text-zinc-600">{untested.length} ?</Badge>}
                          {cred.accesses.length === 0 && <span className="text-xs text-muted-foreground">no tests</span>}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            {/* Expanded credential details */}
            {expandedCred && (() => {
              const cred = domainCreds.find(c => c.id === expandedCred);
              if (!cred) return null;
              return (
                <Card className="bg-zinc-950">
                  <CardContent className="py-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <Key className="size-4 text-muted-foreground" />
                      <span className="font-mono font-medium">
                        {cred.domain ? `${cred.domain}\\` : ""}{cred.username}
                      </span>
                      <Badge variant="outline" className="text-[10px]">{cred.secretType}</Badge>
                    </div>
                    {cred.accesses.length > 0 ? (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Host</TableHead>
                            <TableHead>Protocol</TableHead>
                            <TableHead>Status</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {cred.accesses.map(a => (
                            <TableRow key={a.id}>
                              <TableCell className="font-mono text-sm">{a.host.ip} {a.host.hostname && `(${a.host.hostname})`}</TableCell>
                              <TableCell><Badge variant="outline" className="text-[10px]">{a.protocol}</Badge></TableCell>
                              <TableCell>{statusBadge(a.status, a.isAdmin)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    ) : (
                      <p className="text-xs text-muted-foreground">No access records yet.</p>
                    )}
                  </CardContent>
                </Card>
              );
            })()}
          </>
        )}
      </TabsContent>

      {/* ═══════════════════ ENUM (AD detail) ═══════════════════ */}
      {hasAdEnum && (
        <TabsContent value="enum" className="space-y-4">
          {/* Domain selector */}
          {domains.length > 1 && (
            <Select value={selectedDomainId} onValueChange={v => v && setSelectedDomainId(v)}>
              <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
              <SelectContent>
                {domains.map(d => <SelectItem key={d.id} value={d.id}>{d.domainName}</SelectItem>)}
              </SelectContent>
            </Select>
          )}

          {detail && (
            <Tabs defaultValue="users">
              <TabsList variant="line">
                <TabsTrigger value="users">Users ({detail.users.length})</TabsTrigger>
                <TabsTrigger value="groups">Groups ({detail.groups.length})</TabsTrigger>
                <TabsTrigger value="computers">Computers ({detail.computers.length})</TabsTrigger>
                <TabsTrigger value="trusts">Trusts ({detail.trusts.length})</TabsTrigger>
                <TabsTrigger value="gpos">GPOs ({detail.gpos.length})</TabsTrigger>
              </TabsList>

              {/* Users */}
              <TabsContent value="users" className="space-y-2">
                <div className="flex gap-4">
                  <label className="flex items-center gap-1.5 text-sm">
                    <Checkbox checked={filterKerb} onCheckedChange={c => setFilterKerb(!!c)} /> Kerberoastable
                  </label>
                  <label className="flex items-center gap-1.5 text-sm">
                    <Checkbox checked={filterAsrep} onCheckedChange={c => setFilterAsrep(!!c)} /> ASREProastable
                  </label>
                  <label className="flex items-center gap-1.5 text-sm">
                    <Checkbox checked={filterAdmin} onCheckedChange={c => setFilterAdmin(!!c)} /> AdminCount
                  </label>
                  <span className="text-xs text-muted-foreground ml-auto">
                    {filteredUsers.length} of {detail.users.length}
                  </span>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Username</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>SPN</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredUsers.map(u => (
                      <TableRow key={u.id}>
                        <TableCell className="font-medium">
                          {u.username}
                          {u.kerberoastable && <Badge className="ml-1 bg-red-600 text-[10px]">KERB</Badge>}
                          {u.asrepRoastable && <Badge className="ml-1 bg-orange-600 text-[10px]">ASREP</Badge>}
                          {u.adminCount && <Badge className="ml-1 bg-yellow-600 text-[10px]">ADMIN</Badge>}
                        </TableCell>
                        <TableCell className="text-sm max-w-48 truncate">{u.description}</TableCell>
                        <TableCell className="text-xs max-w-32 truncate">{(tryParse<string[]>(u.spn, [])).join(", ")}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TabsContent>

              {/* Groups */}
              <TabsContent value="groups">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Members</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Description</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.groups.map(g => (
                      <TableRow key={g.id}>
                        <TableCell className="font-medium">{g.name}</TableCell>
                        <TableCell>{g.memberCount}</TableCell>
                        <TableCell className="text-xs">{g.groupType}</TableCell>
                        <TableCell className="text-sm max-w-48 truncate">{g.description}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TabsContent>

              {/* Computers */}
              <TabsContent value="computers">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>OS</TableHead>
                      <TableHead>Security</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.computers.map(c => (
                      <TableRow key={c.id}>
                        <TableCell className="font-medium">
                          {c.name}
                          {c.isDc && <Badge className="ml-1 bg-yellow-600 text-[10px]">DC</Badge>}
                        </TableCell>
                        <TableCell className="text-sm">{c.os} {c.osVersion}</TableCell>
                        <TableCell>
                          {c.unconstrainedDelegation && <Badge variant="destructive" className="text-[10px] mr-1">UNCONSTRAINED</Badge>}
                          {c.rbcd && <Badge variant="destructive" className="text-[10px]">RBCD</Badge>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TabsContent>

              {/* Trusts */}
              <TabsContent value="trusts">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Direction</TableHead>
                      <TableHead>Type</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.trusts.map(t => (
                      <TableRow key={t.id}>
                        <TableCell className="font-medium">{t.name}</TableCell>
                        <TableCell>{t.direction}</TableCell>
                        <TableCell>{t.trustType}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TabsContent>

              {/* GPOs */}
              <TabsContent value="gpos">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Display Name</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Path</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.gpos.map(g => (
                      <TableRow key={g.id}>
                        <TableCell className="font-medium">{g.displayName}</TableCell>
                        <TableCell className="text-xs font-mono">{g.name}</TableCell>
                        <TableCell className="text-xs max-w-48 truncate">{g.path}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TabsContent>
            </Tabs>
          )}
        </TabsContent>
      )}
    </Tabs>
  );
}

// ─── Sub-components ─────────────────────────────────────

function StatCard({ icon: Icon, label, value, color }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string; value: number; color?: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 py-3">
        <div className="rounded-md bg-zinc-800 p-2">
          <Icon className="size-4 text-muted-foreground" />
        </div>
        <div>
          <p className={`text-2xl font-bold ${color || ""}`}>{value}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}
