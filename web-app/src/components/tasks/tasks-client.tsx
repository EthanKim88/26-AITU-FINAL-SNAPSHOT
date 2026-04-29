"use client";

import { useState, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Copy, Check, SkipForward, Terminal } from "lucide-react";
import { apiGet, apiPatch } from "@/lib/fetcher";

interface TaskData {
  id: string;
  type: string;
  priority: string;
  status: string;
  title: string;
  command: string | null;
  context: string | null;
  expectedOutput: string | null;
  result: string | null;
  hostIp: string | null;
  sessionId: number | null;
  session: { id: number; title: string } | null;
  createdAt: string;
  updatedAt: string;
}

const priorityColor: Record<string, string> = {
  critical: "bg-red-600",
  high: "bg-orange-600",
  medium: "bg-yellow-600",
  low: "bg-gray-600",
};

const statusColor: Record<string, string> = {
  pending: "bg-yellow-600",
  "in-progress": "bg-blue-600",
  done: "bg-green-600",
  skipped: "bg-gray-600",
};

const priorityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export function TasksClient({ initialTasks }: { initialTasks: TaskData[] }) {
  const [tasks, setTasks] = useState(initialTasks);
  const [filter, setFilter] = useState("all");
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [resultText, setResultText] = useState("");

  const refresh = useCallback(async () => {
    const data = await apiGet<TaskData[]>("/api/tasks");
    setTasks(data);
  }, []);

  const handleComplete = async (taskId: string) => {
    await apiPatch(`/api/tasks/${taskId}`, { status: "done", result: resultText || null });
    setCompletingId(null);
    setResultText("");
    refresh();
  };

  const handleSkip = async (taskId: string) => {
    await apiPatch(`/api/tasks/${taskId}`, { status: "skipped" });
    refresh();
  };

  const copyCommand = (cmd: string) => {
    navigator.clipboard.writeText(cmd);
  };

  const sorted = [...tasks].sort((a, b) => {
    const pa = priorityOrder[a.priority] ?? 2;
    const pb = priorityOrder[b.priority] ?? 2;
    return pa - pb;
  });

  const filtered = filter === "all" ? sorted : sorted.filter((t) => t.status === filter);

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex gap-2">
        {["all", "pending", "in-progress", "done", "skipped"].map((s) => (
          <Button
            key={s}
            variant={filter === s ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter(s)}
          >
            {s === "all" ? "All" : s}
            {s !== "all" && (
              <span className="ml-1 text-xs">({tasks.filter((t) => t.status === s).length})</span>
            )}
          </Button>
        ))}
      </div>

      {/* Task cards */}
      <div className="space-y-3">
        {filtered.map((t) => (
          <Card key={t.id}>
            <CardContent className="pt-4 space-y-2">
              {/* Header */}
              <div className="flex items-center gap-2">
                <Badge className={priorityColor[t.priority] ?? "bg-gray-600"}>{t.priority}</Badge>
                <Badge className={statusColor[t.status] ?? "bg-gray-600"}>{t.status}</Badge>
                <Badge variant="outline">{t.type}</Badge>
                <span className="font-semibold">{t.title}</span>
                {t.hostIp && <Badge variant="secondary" className="font-mono text-[10px]">{t.hostIp}</Badge>}
                <span className="flex-1" />
                {t.session && (
                  <span className="text-xs text-muted-foreground">Session #{t.session.id}: {t.session.title}</span>
                )}
              </div>

              {/* Context */}
              {t.context && <p className="text-sm text-muted-foreground">{t.context}</p>}

              {/* Command */}
              {t.command && (
                <div className="flex items-start gap-2 bg-muted rounded p-2">
                  <Terminal className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                  <pre className="text-xs font-mono flex-1 whitespace-pre-wrap">{t.command}</pre>
                  <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => copyCommand(t.command!)}>
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
              )}

              {/* Expected output */}
              {t.expectedOutput && (
                <p className="text-xs text-muted-foreground">Expected: {t.expectedOutput}</p>
              )}

              {/* Result (if done) */}
              {t.result && (
                <div className="bg-green-950/30 rounded p-2">
                  <p className="text-xs font-mono whitespace-pre-wrap">{t.result}</p>
                </div>
              )}

              {/* Complete form */}
              {completingId === t.id ? (
                <div className="space-y-2">
                  <Textarea
                    placeholder="Paste result here (optional)..."
                    value={resultText}
                    onChange={(e) => setResultText(e.target.value)}
                    rows={3}
                  />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => handleComplete(t.id)}>
                      <Check className="mr-1 h-3 w-3" />Done
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => { setCompletingId(null); setResultText(""); }}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                t.status === "pending" && (
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => setCompletingId(t.id)}>
                      <Check className="mr-1 h-3 w-3" />Complete
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => handleSkip(t.id)}>
                      <SkipForward className="mr-1 h-3 w-3" />Skip
                    </Button>
                  </div>
                )
              )}

              {/* Timestamp */}
              <p className="text-xs text-muted-foreground">{new Date(t.createdAt).toLocaleString()}</p>
            </CardContent>
          </Card>
        ))}
        {filtered.length === 0 && <p className="text-center text-muted-foreground">No tasks{filter !== "all" ? ` with status "${filter}"` : ""}.</p>}
      </div>
    </div>
  );
}
