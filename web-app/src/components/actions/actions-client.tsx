"use client";

import { useState, useCallback, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, ChevronDown, ChevronUp } from "lucide-react";
import { apiGet } from "@/lib/fetcher";

interface ActionData {
  id: string;
  priority: string;
  action: string;
  reason: string;
  category: string;
  target: string | null;
  context: string;
  fingerprint: string;
  status: string;
  sessionId: number | null;
  session: { id: number; title: string } | null;
  result: string | null;
  createdAt: string;
  claimedAt: string | null;
  completedAt: string | null;
}

interface Stats {
  pending: number;
  inProgress: number;
  done: number;
  failed: number;
  expired: number;
}

const priorityColor: Record<string, string> = {
  critical: "bg-red-600",
  high: "bg-orange-600",
  medium: "bg-yellow-600",
  low: "bg-gray-600",
};

const statusColor: Record<string, string> = {
  pending: "bg-yellow-600",
  in_progress: "bg-blue-600",
  done: "bg-green-600",
  failed: "bg-red-500",
  expired: "bg-gray-500",
};

const statusLabel: Record<string, string> = {
  pending: "Pending",
  in_progress: "In Progress",
  done: "Done",
  failed: "Failed",
  expired: "Expired",
};

const categoryColor: Record<string, string> = {
  recon: "border-sky-500 text-sky-400",
  web: "border-purple-500 text-purple-400",
  ad: "border-blue-500 text-blue-400",
  scada: "border-orange-500 text-orange-400",
  db: "border-cyan-500 text-cyan-400",
  credential: "border-yellow-500 text-yellow-400",
  exploit: "border-red-500 text-red-400",
  pivot: "border-green-500 text-green-400",
};

const priorityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const statusOrder: Record<string, number> = { in_progress: 0, pending: 1, failed: 2, done: 3, expired: 4 };

export function ActionsClient({
  initialActions,
  activeSessions,
  stats: initialStats,
}: {
  initialActions: ActionData[];
  activeSessions: { id: number; title: string }[];
  stats: Stats;
}) {
  const [actions, setActions] = useState(initialActions);
  const [stats, setStats] = useState(initialStats);
  const [filter, setFilter] = useState("active"); // active = pending+in_progress
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const data = await apiGet<ActionData[]>("/api/actions");
      setActions(data);
      setStats({
        pending: data.filter((a) => a.status === "pending").length,
        inProgress: data.filter((a) => a.status === "in_progress").length,
        done: data.filter((a) => a.status === "done").length,
        failed: data.filter((a) => a.status === "failed").length,
        expired: data.filter((a) => a.status === "expired").length,
      });
    } finally {
      setRefreshing(false);
    }
  }, []);

  // Auto-refresh every 10 seconds
  useEffect(() => {
    const interval = setInterval(refresh, 10_000);
    return () => clearInterval(interval);
  }, [refresh]);

  const sorted = [...actions].sort((a, b) => {
    const ss = (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9);
    if (ss !== 0) return ss;
    return (priorityOrder[a.priority] ?? 9) - (priorityOrder[b.priority] ?? 9);
  });

  const filtered = (() => {
    switch (filter) {
      case "active":
        return sorted.filter((a) => a.status === "pending" || a.status === "in_progress");
      case "completed":
        return sorted.filter((a) => a.status === "done" || a.status === "failed" || a.status === "expired");
      default:
        return sorted.filter((a) => a.status === filter);
    }
  })();

  const formatTime = (iso: string | null) => {
    if (!iso) return "-";
    const d = new Date(iso);
    return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  };

  const timeSince = (iso: string) => {
    const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (sec < 60) return `${sec}s ago`;
    if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
    return `${Math.floor(sec / 3600)}h ago`;
  };

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="grid grid-cols-5 gap-2">
        {[
          { label: "Pending", count: stats.pending, color: "text-yellow-400" },
          { label: "In Progress", count: stats.inProgress, color: "text-blue-400" },
          { label: "Done", count: stats.done, color: "text-green-400" },
          { label: "Failed", count: stats.failed, color: "text-red-400" },
          { label: "Expired", count: stats.expired, color: "text-gray-400" },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="py-3 text-center">
              <p className={`text-2xl font-bold ${s.color}`}>{s.count}</p>
              <p className="text-xs text-muted-foreground">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Active sessions indicator */}
      {activeSessions.length > 0 && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
          </span>
          {activeSessions.length} active session{activeSessions.length > 1 ? "s" : ""}:
          {activeSessions.map((s) => (
            <Badge key={s.id} variant="outline" className="text-xs">
              #{s.id} {s.title}
            </Badge>
          ))}
        </div>
      )}

      {/* Filter + refresh */}
      <div className="flex gap-2 items-center">
        {[
          { key: "active", label: `Active (${stats.pending + stats.inProgress})` },
          { key: "pending", label: `Pending (${stats.pending})` },
          { key: "in_progress", label: `In Progress (${stats.inProgress})` },
          { key: "completed", label: `Completed (${stats.done + stats.failed})` },
        ].map((f) => (
          <Button
            key={f.key}
            variant={filter === f.key ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </Button>
        ))}
        <span className="flex-1" />
        <Button variant="ghost" size="sm" onClick={refresh} disabled={refreshing}>
          <RefreshCw className={`h-4 w-4 mr-1 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Action cards */}
      <div className="space-y-2">
        {filtered.map((a) => {
          const expanded = expandedId === a.id;
          let ctx: Record<string, unknown> = {};
          try {
            ctx = JSON.parse(a.context);
          } catch { /* empty */ }

          return (
            <Card key={a.id} className={a.status === "in_progress" ? "border-blue-600/50" : ""}>
              <CardContent className="py-3 space-y-1">
                {/* Header row */}
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge className={priorityColor[a.priority] ?? "bg-gray-600"}>
                    {a.priority}
                  </Badge>
                  <Badge className={statusColor[a.status] ?? "bg-gray-600"}>
                    {statusLabel[a.status] ?? a.status}
                  </Badge>
                  <Badge variant="outline" className={categoryColor[a.category] ?? ""}>
                    {a.category}
                  </Badge>
                  <span className="font-medium text-sm">{a.action}</span>
                  {a.target && (
                    <Badge variant="secondary" className="font-mono text-[10px]">
                      {a.target}
                    </Badge>
                  )}
                  <span className="flex-1" />
                  {a.session && (
                    <span className="text-xs text-blue-400">
                      Session #{a.session.id}: {a.session.title}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {timeSince(a.createdAt)}
                  </span>
                </div>

                {/* Reason */}
                <p className="text-xs text-muted-foreground">{a.reason}</p>

                {/* Result (if done/failed) */}
                {a.result && (
                  <div className={`rounded p-2 text-xs font-mono whitespace-pre-wrap ${
                    a.status === "done"
                      ? "bg-green-950/30 text-green-300"
                      : "bg-red-950/30 text-red-300"
                  }`}>
                    {a.result}
                  </div>
                )}

                {/* Timestamps */}
                {(a.claimedAt || a.completedAt) && (
                  <div className="flex gap-4 text-xs text-muted-foreground">
                    {a.claimedAt && <span>Claimed: {formatTime(a.claimedAt)}</span>}
                    {a.completedAt && <span>Completed: {formatTime(a.completedAt)}</span>}
                  </div>
                )}

                {/* Expandable context */}
                {Object.keys(ctx).length > 0 && (
                  <button
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setExpandedId(expanded ? null : a.id)}
                  >
                    {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    Context
                  </button>
                )}
                {expanded && Object.keys(ctx).length > 0 && (
                  <pre className="bg-muted rounded p-2 text-xs font-mono overflow-x-auto max-h-64 overflow-y-auto">
                    {JSON.stringify(ctx, null, 2)}
                  </pre>
                )}
              </CardContent>
            </Card>
          );
        })}
        {filtered.length === 0 && (
          <p className="text-center text-muted-foreground py-8">
            No actions matching filter.
          </p>
        )}
      </div>
    </div>
  );
}
