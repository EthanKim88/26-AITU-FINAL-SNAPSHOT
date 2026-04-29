"use client";

import { useState, useCallback, useMemo } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/fetcher";

interface Access {
  id: string; protocol: string; port: number | null; status: string; isAdmin: boolean;
  host: { id: string; ip: string; hostname: string };
}
interface CredRow {
  id: string; username: string; secret: string; secretType: string;
  credType: string; domain: string; source: string; notes: string;
  accesses: Access[];
}
interface HostWithPorts {
  id: string; ip: string; hostname: string;
  ports: { port: number; service: string }[];
}

interface AccessByHostRow {
  hostId: string;
  ip: string;
  hostname: string;
  accesses: Array<{
    accessId: string;
    credId: string;
    username: string;
    secret: string;
    domain: string;
    credType: string;
    secretType: string;
    protocol: string;
    port: number | null;
    status: string;
    isAdmin: boolean;
    source: string;
  }>;
}

const secretTypes = ["password", "ntlm_hash", "aes_key", "kerberos_ticket", "ssh_key", "token", "certificate"];
const credTypes = ["domain", "local", "service", "webapp", "unknown"];

function statusBadge(status: string, isAdmin: boolean) {
  if (status === "valid" && isAdmin) return <Badge className="bg-red-600 text-[10px]">vA</Badge>;
  if (status === "valid") return <Badge className="bg-green-600 text-[10px]">v</Badge>;
  if (status === "invalid") return <Badge className="bg-gray-600 text-[10px]">x</Badge>;
  if (status === "untested") return <Badge variant="outline" className="text-[10px]">?</Badge>;
  return <span className="text-xs">-</span>;
}

function credentialName(username: string, domain: string) {
  return `${username}${domain ? `@${domain}` : ""}`;
}

function CredentialInline({ username, domain, secret, className = "" }: {
  username: string;
  domain: string;
  secret: string;
  className?: string;
}) {
  return (
    <span className={`inline-flex flex-wrap items-baseline gap-x-2 gap-y-1 ${className}`}>
      <span>{credentialName(username, domain)}</span>
      {secret ? <span className="break-all whitespace-pre-wrap">{secret}</span> : null}
    </span>
  );
}

export function CredentialsClient({ initialCreds, hosts }: {
  initialCreds: CredRow[]; hosts: HostWithPorts[];
}) {
  const [creds, setCreds] = useState(initialCreds);

  const accessByHost = useMemo<AccessByHostRow[]>(() => {
    const map = new Map<string, AccessByHostRow>();
    for (const c of creds) {
      for (const a of c.accesses) {
        const key = a.host.id;
        if (!map.has(key)) {
          map.set(key, {
            hostId: a.host.id,
            ip: a.host.ip,
            hostname: a.host.hostname,
            accesses: [],
          });
        }
        map.get(key)!.accesses.push({
          accessId: a.id,
          credId: c.id,
          username: c.username,
          secret: c.secret,
          domain: c.domain,
          credType: c.credType,
          secretType: c.secretType,
          protocol: a.protocol,
          port: a.port,
          status: a.status,
          isAdmin: a.isAdmin,
          source: c.source,
        });
      }
    }

    const rows = Array.from(map.values()).map((row) => {
      const sortedAccesses = [...row.accesses].sort((x, y) => {
        const byStatus = x.status.localeCompare(y.status);
        if (byStatus !== 0) return byStatus;
        const byCred = `${x.username}@${x.domain}`.localeCompare(`${y.username}@${y.domain}`);
        if (byCred !== 0) return byCred;
        return (x.port ?? 0) - (y.port ?? 0);
      });
      return { ...row, accesses: sortedAccesses };
    });

    rows.sort((a, b) => a.ip.localeCompare(b.ip, undefined, { numeric: true }));
    return rows;
  }, [creds]);

  const refresh = useCallback(async () => {
    const data = await apiGet<CredRow[]>("/api/credentials");
    setCreds(data);
  }, []);

  const handleDelete = async (credId: string) => {
    await apiDelete(`/api/credentials/${credId}`);
    refresh();
  };

  const handleAccessStatusChange = async (credId: string, accessId: string, status: string) => {
    await apiPatch(`/api/credentials/${credId}/access/${accessId}`, { status });
    refresh();
  };

  const handleAccessAdminToggle = async (credId: string, accessId: string, isAdmin: boolean) => {
    await apiPatch(`/api/credentials/${credId}/access/${accessId}`, { isAdmin });
    refresh();
  };

  // Build matrix columns: host:port pairs from access records + host open ports
  type MatrixCol = { hostId: string; ip: string; port: number | null; label: string; key: string };
  const matrixCols: MatrixCol[] = [];
  const colKeys = new Set<string>();

  // Collect columns from existing access records (includes ports tested)
  for (const c of creds) {
    for (const a of c.accesses) {
      const key = `${a.host.id}:${a.port ?? a.protocol}`;
      if (!colKeys.has(key)) {
        colKeys.add(key);
        matrixCols.push({
          hostId: a.host.id, ip: a.host.ip, port: a.port,
          label: a.port ? `${a.host.ip}:${a.port}` : `${a.host.ip} (${a.protocol})`,
          key,
        });
      }
    }
  }

  // Also add open ports from hosts that might not have access records yet
  for (const h of hosts) {
    for (const p of h.ports) {
      const key = `${h.id}:${p.port}`;
      if (!colKeys.has(key)) {
        colKeys.add(key);
        matrixCols.push({
          hostId: h.id, ip: h.ip, port: p.port,
          label: `${h.ip}:${p.port}`,
          key,
        });
      }
    }
  }

  // Sort: by IP then port
  matrixCols.sort((a, b) => a.ip.localeCompare(b.ip) || (a.port ?? 0) - (b.port ?? 0));

  // Group columns by host IP for headers
  const hostGroups: { ip: string; cols: MatrixCol[] }[] = [];
  for (const col of matrixCols) {
    const last = hostGroups[hostGroups.length - 1];
    if (last && last.ip === col.ip) {
      last.cols.push(col);
    } else {
      hostGroups.push({ ip: col.ip, cols: [col] });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{creds.length} credentials</span>
        <AddCredentialDialog onCreated={refresh} />
      </div>

      <Tabs defaultValue="by-ip">
        <TabsList>
          <TabsTrigger value="by-ip">By IP</TabsTrigger>
          <TabsTrigger value="list">By Credential</TabsTrigger>
          <TabsTrigger value="matrix">Matrix</TabsTrigger>
        </TabsList>

        <TabsContent value="by-ip" className="space-y-3">
          {accessByHost.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No credential access records yet.</p>
          ) : (
            accessByHost.map((hostRow) => {
              const tested = hostRow.accesses.filter((a) => a.status !== "untested");
              const valid = hostRow.accesses.filter((a) => a.status === "valid");
              const admin = hostRow.accesses.filter((a) => a.status === "valid" && a.isAdmin);

              return (
                <div key={hostRow.hostId} className="rounded-lg border p-3 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm">{hostRow.ip}</span>
                    {hostRow.hostname && <span className="text-xs text-muted-foreground">({hostRow.hostname})</span>}
                    <Badge variant="outline" className="text-[10px]">
                      Tested {tested.length}/{hostRow.accesses.length}
                    </Badge>
                    <Badge className="bg-green-600 text-[10px]">Valid {valid.length}</Badge>
                    <Badge className="bg-orange-500 text-[10px]">Admin {admin.length}</Badge>
                  </div>

                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Credential</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Protocol</TableHead>
                        <TableHead>Port</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Source</TableHead>
                      </TableRow>
                    </TableHeader>
                      <TableBody>
                      {hostRow.accesses.map((a) => (
                        <TableRow key={a.accessId}>
                          <TableCell className="font-mono text-xs">
                            <CredentialInline username={a.username} domain={a.domain} secret={a.secret} />
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-[10px]">{a.credType}</Badge>
                          </TableCell>
                          <TableCell className="font-mono text-xs">{a.protocol || "—"}</TableCell>
                          <TableCell className="font-mono text-xs">{a.port ?? "—"}</TableCell>
                          <TableCell>{statusBadge(a.status, a.isAdmin)}</TableCell>
                          <TableCell className="text-xs max-w-48 truncate" title={a.source}>
                            {a.source || "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              );
            })
          )}
        </TabsContent>

        <TabsContent value="list">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Credential</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>CredType</TableHead>
                <TableHead>Domain</TableHead>
                <TableHead>Targets</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Valid/Total</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {creds.map((c) => {
                const valid = c.accesses.filter((a) => a.status === "valid").length;
                // Show host:port pairs instead of just IPs
                const targets = c.accesses.map((a) => a.port ? `${a.host.ip}:${a.port}` : `${a.host.ip}/${a.protocol}`);
                const uniqueTargets = [...new Set(targets)];
                return (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono text-xs max-w-xl">
                      <CredentialInline username={c.username} domain={c.domain} secret={c.secret} className="w-full" />
                    </TableCell>
                    <TableCell><Badge variant="outline" className="text-[10px]">{c.secretType}</Badge></TableCell>
                    <TableCell><Badge variant="outline" className="text-[10px]">{c.credType}</Badge></TableCell>
                    <TableCell className="text-sm">{c.domain || "—"}</TableCell>
                    <TableCell>
                      <div className="flex gap-1 flex-wrap">
                        {uniqueTargets.length > 0 ? uniqueTargets.map((t) => {
                          const access = c.accesses.find((a) => (a.port ? `${a.host.ip}:${a.port}` : `${a.host.ip}/${a.protocol}`) === t);
                          const color = access?.status === "valid" ? "bg-green-600/10 border-green-600/30" :
                            access?.status === "invalid" ? "bg-gray-600/10 border-gray-600/30" : "";
                          return (
                            <Badge key={t} variant="outline" className={`text-[10px] font-mono ${color}`}>
                              {t}
                            </Badge>
                          );
                        }) : <span className="text-xs text-muted-foreground">—</span>}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm max-w-32 truncate" title={c.source}>{c.source || "—"}</TableCell>
                    <TableCell>{valid}/{c.accesses.length}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDelete(c.id)}>
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {creds.length === 0 && (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">No credentials</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </TabsContent>

        <TabsContent value="matrix">
          {matrixCols.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No credential access records or open ports found.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  {/* Host IP row (grouped) */}
                  <TableRow>
                    <TableHead className="sticky left-0 bg-background z-10" rowSpan={2}>Credential</TableHead>
                    {hostGroups.map((g) => (
                      <TableHead key={g.ip} colSpan={g.cols.length} className="text-center text-xs border-l border-border">
                        {g.ip}
                      </TableHead>
                    ))}
                  </TableRow>
                  {/* Port row */}
                  <TableRow>
                    {matrixCols.map((col) => (
                      <TableHead key={col.key} className="text-center text-[10px] whitespace-nowrap px-1">
                        {col.port ?? col.key.split(":")[1]}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {creds.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="sticky left-0 bg-background z-10 font-mono text-xs">
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                          <CredentialInline username={c.username} domain={c.domain} secret={c.secret} />
                          <span className="text-muted-foreground">[{c.credType}]</span>
                        </div>
                      </TableCell>
                      {matrixCols.map((col) => {
                        // Find access for this credential + host:port
                        const access = c.accesses.find((a) =>
                          a.host.id === col.hostId && (
                            col.port !== null
                              ? a.port === col.port
                              : a.port === null && `${col.hostId}:${a.protocol}` === col.key
                          )
                        );
                        if (!access) {
                          return <TableCell key={col.key} className="text-center px-1"><span className="text-xs text-muted-foreground">-</span></TableCell>;
                        }
                        return (
                          <TableCell key={col.key} className="text-center px-1">
                            <button
                              title={`${access.protocol}${access.port ? `:${access.port}` : ""} → ${access.status}${access.isAdmin ? " (admin)" : ""}`}
                              onClick={() => {
                                const next = access.status === "untested" ? "valid" : access.status === "valid" ? "invalid" : "untested";
                                handleAccessStatusChange(c.id, access.id, next);
                              }}
                              onContextMenu={(e) => { e.preventDefault(); handleAccessAdminToggle(c.id, access.id, !access.isAdmin); }}
                            >
                              {statusBadge(access.status, access.isAdmin)}
                            </button>
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function AddCredentialDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [secret, setSecret] = useState("");
  const [secretType, setSecretType] = useState("password");
  const [credType, setCredType] = useState("unknown");
  const [domain, setDomain] = useState("");
  const [source, setSource] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) return;
    setLoading(true);
    try {
      await apiPost("/api/credentials", {
        username: username.trim(), secret, secretType, credType, domain, source,
      });
      setOpen(false);
      setUsername(""); setSecret(""); setDomain(""); setSource("");
      onCreated();
    } finally { setLoading(false); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button><Plus className="mr-2 h-4 w-4" />Add Credential</Button>} />
      <DialogContent>
        <DialogHeader><DialogTitle>Add Credential</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2"><Label>Username *</Label><Input value={username} onChange={(e) => setUsername(e.target.value)} required /></div>
            <div className="space-y-2"><Label>Domain</Label><Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="CORP.LOCAL" /></div>
          </div>
          <div className="space-y-2"><Label>Secret</Label><Input value={secret} onChange={(e) => setSecret(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Secret Type</Label>
              <Select value={secretType} onValueChange={(v) => v && setSecretType(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{secretTypes.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Cred Type</Label>
              <Select value={credType} onValueChange={(v) => v && setCredType(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{credTypes.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2"><Label>Source</Label><Input value={source} onChange={(e) => setSource(e.target.value)} placeholder="Where found" /></div>
          <Button type="submit" disabled={loading || !username.trim()} className="w-full">{loading ? "Adding..." : "Add"}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
