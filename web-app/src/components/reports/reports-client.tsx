"use client";

import { useCallback, useMemo, useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/fetcher";
import { buildDefaultReportDescription } from "@/lib/report-description";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type ReportType = "bug_bounty" | "risk";
type ReportStatus = "pending" | "submit" | "accept" | "reject" | "ignore";

interface AttachmentRow {
  id: string;
  reportId: string;
  fileName: string;
  localPath: string;
  mimeType: string;
  attachmentType: string;
  requirementKey: string;
  isFullScreen: boolean;
  size: number;
  notes: string;
  createdAt: string;
}

interface BugTypeRow {
  id: string;
  name: string;
  points: number;
  requiredRules: string;
  updatedAt: string;
  rulesDraft: RequiredRule[];
}

interface RiskRow {
  id: string;
  name: string;
  description: string;
  point: number;
  updatedAt: string;
}

interface ReportRow {
  id: string;
  reportType: ReportType;
  bugTypeId: string | null;
  bugType: BugTypeRow | null;
  riskId: string | null;
  risk: RiskRow | null;
  targetIp: string;
  descriptionMd: string;
  status: ReportStatus;
  notes: string;
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
  attachments: AttachmentRow[];
}

interface RequiredRule {
  key: string;
  label: string;
  type: string;
  required: boolean;
}

function sortRisks(items: RiskRow[]): RiskRow[] {
  return [...items].sort((a, b) => {
    if (b.point !== a.point) return b.point - a.point;
    return a.name.localeCompare(b.name);
  });
}

const defaultAttachmentRuleType = "screenshot";

const reportStatuses: ReportStatus[] = ["pending", "submit", "accept", "reject", "ignore"];

const reportStatusColor: Record<ReportStatus, string> = {
  pending: "bg-yellow-600",
  submit: "bg-blue-600",
  accept: "bg-green-600",
  reject: "bg-red-600",
  ignore: "bg-gray-600",
};

function parseRequiredRules(raw: string): RequiredRule[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item === "object")
      .map((item) => {
        const row = item as Partial<RequiredRule>;
        return {
          key: String(row.key ?? "").trim(),
          label: String(row.label ?? row.key ?? "").trim(),
          type: String(row.type ?? "screenshot"),
          required: Boolean(row.required),
        };
      })
      .filter((rule) => rule.key);
  } catch {
    return [];
  }
}

function normalizeRuleBase(value: string, fallbackIndex: number): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (slug) return slug;
  return `attachment_${fallbackIndex + 1}`;
}

function rulesToText(rules: RequiredRule[]): string {
  return rules
    .map((rule) => (rule.label || rule.key).trim())
    .filter(Boolean)
    .join("\n");
}

function textToRules(text: string, previousRules: RequiredRule[] = []): RequiredRule[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const usedKeys = new Set<string>();

  return lines.map((line, index) => {
    const base = normalizeRuleBase(line, index);
    const matched = previousRules.find((rule) => rule.label === line || rule.key === base);
    let key = matched?.key?.trim() || base;
    let dedupe = 2;
    while (usedKeys.has(key)) {
      key = `${base}_${dedupe}`;
      dedupe += 1;
    }
    usedKeys.add(key);

    return {
      key,
      label: line,
      type: matched?.type || defaultAttachmentRuleType,
      required: matched?.required ?? true,
    };
  });
}

export function ReportsClient({
  initialReports,
  initialBugTypes,
  initialRisks,
}: {
  initialReports: ReportRow[];
  initialBugTypes: BugTypeRow[];
  initialRisks: RiskRow[];
}) {
  const [reports, setReports] = useState<ReportRow[]>(initialReports);
  const [bugTypes, setBugTypes] = useState<BugTypeRow[]>(
    initialBugTypes.map((item) => ({ ...item, rulesDraft: parseRequiredRules(item.requiredRules) }))
  );
  const [risks, setRisks] = useState<RiskRow[]>(() => sortRisks(initialRisks));
  const [activeTab, setActiveTab] = useState("reports");
  const [selectedReportId, setSelectedReportId] = useState<string | null>(initialReports[0]?.id ?? null);
  const [reportTypeFilter, setReportTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [ipFilter, setIpFilter] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // Bug type add form
  const [newBugName, setNewBugName] = useState("");
  const [newBugPoints, setNewBugPoints] = useState("");
  const [newBugRulesText, setNewBugRulesText] = useState("");

  const selectedReport = useMemo(
    () => reports.find((r) => r.id === selectedReportId) ?? null,
    [reports, selectedReportId]
  );

  const filteredReports = useMemo(() => {
    return reports.filter((report) => {
      if (reportTypeFilter !== "all" && report.reportType !== reportTypeFilter) return false;
      if (statusFilter !== "all" && report.status !== statusFilter) return false;
      if (ipFilter && !report.targetIp.toLowerCase().includes(ipFilter.toLowerCase())) return false;
      return true;
    });
  }, [reports, reportTypeFilter, statusFilter, ipFilter]);

  const sortedRisks = useMemo(() => sortRisks(risks), [risks]);

  const getBugTypeLabel = useCallback((report: ReportRow) => {
    const resolved = report.bugType ?? bugTypes.find((item) => item.id === report.bugTypeId) ?? null;
    if (!resolved) return "—";
    return resolved.name;
  }, [bugTypes]);

  const refreshAll = useCallback(async () => {
    const [nextReports, nextBugTypes, nextRisks] = await Promise.all([
      apiGet<ReportRow[]>("/api/reports"),
      apiGet<BugTypeRow[]>("/api/report/bug-types"),
      apiGet<RiskRow[]>("/api/report/risks"),
    ]);
    setReports(nextReports);
    setBugTypes(nextBugTypes.map((item) => ({
      ...item,
      rulesDraft: parseRequiredRules(item.requiredRules),
    })));
    setRisks(sortRisks(nextRisks));
    if (!nextReports.some((report) => report.id === selectedReportId)) {
      setSelectedReportId(nextReports[0]?.id ?? null);
    }
  }, [selectedReportId]);

  const createReport = async (reportType: ReportType) => {
    setError("");
    try {
      const fallbackBugTypeId = bugTypes[0]?.id ?? null;
      const fallbackRiskId = sortedRisks[0]?.id ?? null;

      const created = await apiPost<ReportRow>("/api/reports", {
        reportType,
        bugTypeId: reportType === "bug_bounty" ? fallbackBugTypeId : null,
        riskId: reportType === "risk" ? fallbackRiskId : null,
        targetIp: "",
        descriptionMd: buildDefaultReportDescription(reportType),
        status: "pending",
      });

      await refreshAll();
      setSelectedReportId(created.id);
      setActiveTab("reports");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create report");
    }
  };

  const updateSelectedLocal = (patch: Partial<ReportRow>) => {
    if (!selectedReport) return;
    setReports((prev) => prev.map((item) => (item.id === selectedReport.id ? { ...item, ...patch } : item)));
  };

  const saveSelected = async () => {
    if (!selectedReport) return;
    setSaving(true);
    setError("");
    try {
      const updated = await apiPatch<ReportRow>(`/api/reports/${selectedReport.id}`, {
        reportType: selectedReport.reportType,
        bugTypeId: selectedReport.bugTypeId,
        riskId: selectedReport.riskId,
        targetIp: selectedReport.targetIp,
        descriptionMd: selectedReport.descriptionMd,
        status: selectedReport.status,
        notes: selectedReport.notes,
      });
      setReports((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save report");
    } finally {
      setSaving(false);
    }
  };

  const saveSelectedStatus = async (nextStatus: ReportStatus) => {
    if (!selectedReport || selectedReport.status === nextStatus) return;

    const reportId = selectedReport.id;
    const previousStatus = selectedReport.status;
    updateSelectedLocal({ status: nextStatus });
    setSaving(true);
    setError("");

    try {
      const updated = await apiPatch<ReportRow>(`/api/reports/${reportId}`, {
        status: nextStatus,
      });

      setReports((prev) => prev.map((item) => (
        item.id === reportId
          ? {
            ...item,
            status: updated.status,
            submittedAt: updated.submittedAt,
            updatedAt: updated.updatedAt,
          }
          : item
      )));
    } catch (e) {
      setReports((prev) => prev.map((item) => (
        item.id === reportId
          ? { ...item, status: previousStatus }
          : item
      )));
      setError(e instanceof Error ? e.message : "Failed to update report status");
    } finally {
      setSaving(false);
    }
  };

  const deleteSelected = async () => {
    if (!selectedReport) return;
    if (!confirm("Delete selected report?")) return;
    setError("");
    try {
      await apiDelete(`/api/reports/${selectedReport.id}`);
      await refreshAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete report");
    }
  };

  const addBugType = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBugName.trim()) return;
    setError("");
    try {
      await apiPost("/api/report/bug-types", {
        name: newBugName.trim(),
        points: parseInt(newBugPoints, 10) || 0,
        requiredRules: JSON.stringify(textToRules(newBugRulesText)),
      });
      setNewBugName("");
      setNewBugPoints("");
      setNewBugRulesText("");
      await refreshAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add bug type");
    }
  };

  const saveBugType = async (row: BugTypeRow) => {
    setError("");
    try {
      await apiPatch(`/api/report/bug-types/${row.id}`, {
        name: row.name,
        points: row.points,
        requiredRules: JSON.stringify(row.rulesDraft),
      });
      await refreshAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save bug type");
    }
  };

  const updateBugTypeRulesFromText = (bugTypeId: string, text: string) => {
    setBugTypes((prev) => prev.map((row) => {
      if (row.id !== bugTypeId) return row;
      const next = textToRules(text, row.rulesDraft);
      return { ...row, rulesDraft: next };
    }));
  };

  const deleteBugType = async (bugTypeId: string) => {
    if (!confirm("Delete this bug type?")) return;
    setError("");
    try {
      await apiDelete(`/api/report/bug-types/${bugTypeId}`);
      await refreshAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete bug type");
    }
  };

  return (
    <div className="space-y-4">
      {error && (
        <Card className="border-red-500/40">
          <CardContent className="py-3 text-sm text-red-400">{error}</CardContent>
        </Card>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList variant="line">
          <TabsTrigger value="reports">Reports</TabsTrigger>
          <TabsTrigger value="bug-types">Bug Type</TabsTrigger>
          <TabsTrigger value="risks">Risks</TabsTrigger>
        </TabsList>

        <TabsContent value="reports" className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => createReport("bug_bounty")}>New Bug Bounty</Button>
            <Button variant="outline" onClick={() => createReport("risk")}>New Risk</Button>
            <span className="flex-1" />
            <Input
              placeholder="Filter target IP"
              value={ipFilter}
              onChange={(e) => setIpFilter(e.target.value)}
              className="w-48"
            />
            <Select value={reportTypeFilter} onValueChange={(value) => value && setReportTypeFilter(value)}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="bug_bounty">bug_bounty</SelectItem>
                <SelectItem value="risk">risk</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={(value) => value && setStatusFilter(value)}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                {reportStatuses.map((status) => (
                  <SelectItem key={status} value={status}>{status}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Reports List */}
          <Card className="min-w-0">
            <CardHeader className="pb-2">
              <CardTitle>Reports</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="max-h-64 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ID</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Risk / Bug</TableHead>
                      <TableHead>IP</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredReports.map((report) => (
                      <TableRow
                        key={report.id}
                        className={`cursor-pointer ${selectedReportId === report.id ? "bg-muted/50" : ""}`}
                        onClick={() => setSelectedReportId(report.id)}
                      >
                        <TableCell className="font-mono text-xs text-muted-foreground">{report.id.slice(0, 8)}</TableCell>
                        <TableCell className="font-mono text-xs">{report.reportType}</TableCell>
                        <TableCell className="text-xs truncate max-w-48">
                          {report.reportType === "risk"
                            ? report.risk
                              ? report.risk.name
                              : "—"
                            : getBugTypeLabel(report)}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{report.targetIp || "—"}</TableCell>
                        <TableCell>
                          <Badge className={reportStatusColor[report.status]}>{report.status}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                    {filteredReports.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-muted-foreground">
                          No reports
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Report Detail + Markdown Preview */}
          {selectedReport && (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card className="min-w-0">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2">
                    Report Detail
                    <code className="text-xs font-normal text-muted-foreground bg-muted px-1.5 py-0.5 rounded select-all cursor-pointer" title="Click to select full ID">{selectedReport.id}</code>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 [&_[data-slot=select-trigger]]:w-full [&_.space-y-1]:space-y-1.5">
                  <div className="grid grid-cols-3 gap-2">
                    <div className="space-y-1">
                      <Label>Type</Label>
                      <Select
                        value={selectedReport.reportType}
                        onValueChange={(value) => {
                          const nextType = value as ReportType;
                          if (nextType === "bug_bounty") {
                            updateSelectedLocal({ reportType: nextType, bugTypeId: bugTypes[0]?.id ?? null, riskId: null });
                          } else {
                            updateSelectedLocal({ reportType: nextType, bugTypeId: null, riskId: sortedRisks[0]?.id ?? null });
                          }
                        }}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="bug_bounty">bug_bounty</SelectItem>
                          <SelectItem value="risk">risk</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1">
                      {selectedReport.reportType === "bug_bounty" ? (
                        <>
                          <Label>Bug Type</Label>
                          <Select
                            value={selectedReport.bugTypeId ?? "none"}
                            onValueChange={(value) => updateSelectedLocal({ bugTypeId: value === "none" ? null : value })}
                          >
                            <SelectTrigger>
                              <span className="flex flex-1 text-left truncate" data-slot="select-value">
                                {(() => {
                                  if (!selectedReport.bugTypeId) {
                                    return <span className="text-muted-foreground">Select bug type</span>;
                                  }
                                  const bug = bugTypes.find((item) => item.id === selectedReport.bugTypeId);
                                  return bug ? `${bug.name} (${bug.points})` : "—";
                                })()}
                              </span>
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">None</SelectItem>
                              {bugTypes.map((item) => (
                                <SelectItem key={item.id} value={item.id}>
                                  {item.name} ({item.points})
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </>
                      ) : (
                        <>
                          <Label>Risk</Label>
                          <Select
                            value={selectedReport.riskId ?? "none"}
                            onValueChange={(value) => updateSelectedLocal({ riskId: value === "none" ? null : value })}
                          >
                            <SelectTrigger>
                              <span className="flex flex-1 text-left truncate" data-slot="select-value">
                                {(() => {
                                  if (!selectedReport.riskId) return <span className="text-muted-foreground">Select risk</span>;
                                  const r = sortedRisks.find((r) => r.id === selectedReport.riskId);
                                  return r ? r.name : "—";
                                })()}
                              </span>
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">None</SelectItem>
                              {sortedRisks.map((item) => (
                                <SelectItem key={item.id} value={item.id}>
                                  {item.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </>
                      )}
                    </div>

                    <div className="space-y-1">
                      <Label>Status</Label>
                      <Select
                        value={selectedReport.status}
                        onValueChange={(value) => void saveSelectedStatus(value as ReportStatus)}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {reportStatuses.map((status) => (
                            <SelectItem key={status} value={status}>{status}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {selectedReport.reportType === "bug_bounty" && (
                    <div className="space-y-1">
                      <Label>Target IP</Label>
                      <Input
                        value={selectedReport.targetIp}
                        onChange={(e) => updateSelectedLocal({ targetIp: e.target.value })}
                        placeholder="10.1.2.10"
                      />
                    </div>
                  )}

                  <div className="space-y-1">
                    <Label>Description (Markdown)</Label>
                    <Textarea
                      value={selectedReport.descriptionMd}
                      onChange={(e) => updateSelectedLocal({ descriptionMd: e.target.value })}
                      rows={12}
                      className="font-mono text-xs"
                    />
                  </div>

                  <div className="space-y-1">
                    <Label>Notes</Label>
                    <Textarea
                      value={selectedReport.notes}
                      onChange={(e) => updateSelectedLocal({ notes: e.target.value })}
                      rows={3}
                    />
                  </div>

                  <div className="flex gap-2">
                    <Button onClick={saveSelected} disabled={saving}>
                      {saving ? "Saving..." : "Save"}
                    </Button>
                    <Button variant="destructive" onClick={deleteSelected}>Delete</Button>
                  </div>
                </CardContent>
              </Card>

              <Card className="min-w-0">
                <CardHeader className="pb-2">
                  <CardTitle>Description Preview</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="prose prose-sm prose-invert max-w-none [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:rounded [&_pre]:text-xs [&_pre]:overflow-x-auto [&_code]:text-xs [&_code]:bg-muted [&_code]:px-1 [&_code]:rounded [&_table]:text-xs [&_th]:border [&_th]:px-2 [&_th]:py-1 [&_td]:border [&_td]:px-2 [&_td]:py-1">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {selectedReport.descriptionMd || "*No description*"}
                    </ReactMarkdown>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        <TabsContent value="bug-types" className="space-y-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle>Bug Type Catalog</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {bugTypes.map((item) => (
                <div key={item.id} className="rounded border p-3 space-y-3">
                  <div className="flex items-center gap-2">
                    <Input
                      value={item.name}
                      onChange={(e) => setBugTypes((prev) => prev.map((row) => (
                        row.id === item.id ? { ...row, name: e.target.value } : row
                      )))}
                      className="flex-1"
                      placeholder="Bug type name"
                    />
                    <Input
                      type="number"
                      value={item.points}
                      onChange={(e) => setBugTypes((prev) => prev.map((row) => (
                        row.id === item.id ? { ...row, points: parseInt(e.target.value || "0", 10) || 0 } : row
                      )))}
                      className="w-24"
                      placeholder="Points"
                    />
                    <Button size="sm" onClick={() => saveBugType(item)}>Save</Button>
                    <Button size="sm" variant="destructive" onClick={() => deleteBugType(item.id)}>Delete</Button>
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground">Required Attachments</p>
                    <Textarea
                      value={rulesToText(item.rulesDraft)}
                      onChange={(e) => updateBugTypeRulesFromText(item.id, e.target.value)}
                      placeholder={"One requirement per line\nExample: Full-screen whoami output\nExample: Full-screen ipconfig output"}
                      rows={4}
                      className="text-xs"
                    />
                    <p className="text-xs text-muted-foreground">
                      One line = one required attachment. Rule key is auto-generated.
                    </p>
                  </div>
                </div>
              ))}

              {/* Add new bug type */}
              <div className="rounded border border-dashed p-3 space-y-3">
                <p className="text-xs font-semibold text-muted-foreground">Add New Bug Type</p>
                <form onSubmit={addBugType} className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Input value={newBugName} onChange={(e) => setNewBugName(e.target.value)} placeholder="Bug type name" className="flex-1" />
                    <Input value={newBugPoints} onChange={(e) => setNewBugPoints(e.target.value)} placeholder="Points" type="number" className="w-24" />
                    <Button type="submit" disabled={!newBugName.trim()}>Add</Button>
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">Required Attachments</p>
                    <Textarea
                      value={newBugRulesText}
                      onChange={(e) => setNewBugRulesText(e.target.value)}
                      placeholder={"One requirement per line\nExample: Full-screen whoami output\nExample: Full-screen ipconfig output"}
                      rows={4}
                      className="text-xs"
                    />
                    <p className="text-xs text-muted-foreground">
                      One line = one required attachment. Rule key is auto-generated.
                    </p>
                  </div>
                </form>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="risks" className="space-y-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle>Risk Catalog</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[28rem] min-w-[28rem]">Name</TableHead>
                    <TableHead className="w-28">Point</TableHead>
                    <TableHead>Description</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedRisks.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="min-w-[28rem] align-top text-sm font-medium whitespace-normal break-words">
                        {item.name}
                      </TableCell>
                      <TableCell className="align-top font-mono text-sm">
                        {item.point.toLocaleString()}
                      </TableCell>
                      <TableCell className="align-top text-sm whitespace-pre-wrap break-words text-muted-foreground">
                        {item.description || "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
