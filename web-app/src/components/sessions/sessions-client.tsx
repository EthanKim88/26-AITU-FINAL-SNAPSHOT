"use client";

import { useState, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp, Copy } from "lucide-react";
import { apiGet } from "@/lib/fetcher";

interface EntryData {
  id: string;
  seq: number;
  type: string;
  content: string;
  createdAt: string;
}

interface SessionData {
  id: number;
  title: string;
  status: string;
  goal: string | null;
  summary: string | null;
  createdAt: string;
  updatedAt: string;
  _count: { entries: number; tasks: number };
  tasks: { status: string }[];
  entries: EntryData[];
}

interface SessionDetail {
  id: number;
  title: string;
  status: string;
  goal: string | null;
  summary: string | null;
  entries: EntryData[];
  tasks: { id: string; type: string; priority: string; status: string; title: string; createdAt: string }[];
}

const statusColor: Record<string, string> = {
  active: "bg-green-600",
  paused: "bg-yellow-600",
  completed: "bg-blue-600",
};

const entryTypeColor: Record<string, string> = {
  action: "text-blue-400",
  analysis: "text-purple-400",
  request: "text-orange-400",
  result: "text-green-400",
  decision: "text-yellow-400",
  note: "text-gray-400",
};

export function SessionsClient({ initialSessions }: { initialSessions: SessionData[] }) {
  const [sessions, setSessions] = useState(initialSessions);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);

  const refresh = useCallback(async () => {
    const data = await apiGet<SessionData[]>("/api/sessions");
    setSessions(data);
  }, []);

  const toggleExpand = async (sessionId: number) => {
    if (expandedId === sessionId) {
      setExpandedId(null);
      setDetail(null);
      return;
    }
    const d = await apiGet<SessionDetail>(`/api/sessions/${sessionId}`);
    setExpandedId(sessionId);
    setDetail(d);
  };

  const copyId = (id: number) => {
    navigator.clipboard.writeText(String(id));
  };

  return (
    <div className="space-y-3">
      {sessions.map((s) => {
        const pending = s.tasks.filter((t) => t.status === "pending").length;
        const done = s.tasks.filter((t) => t.status === "done").length;
        const isExpanded = expandedId === s.id;

        return (
          <Card key={s.id}>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 cursor-pointer" onClick={() => toggleExpand(s.id)}>
                <Badge className={statusColor[s.status] ?? "bg-gray-600"}>
                  {s.status}
                </Badge>
                <span className="font-mono text-sm text-muted-foreground">#{s.id}</span>
                <span className="font-semibold">{s.title}</span>
                <span className="flex-1" />
                <span className="text-xs text-muted-foreground">
                  {s._count.entries} entries, {done}/{s._count.tasks} tasks done
                  {pending > 0 && `, ${pending} pending`}
                </span>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); copyId(s.id); }}>
                  <Copy className="h-3 w-3" />
                </Button>
                {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </div>

              {s.goal && <p className="text-sm text-muted-foreground mt-1">{s.goal}</p>}
              {s.summary && <p className="text-sm mt-1 text-blue-400">{s.summary}</p>}

              {/* Preview: last 3 entries */}
              {!isExpanded && s.entries.length > 0 && (
                <div className="mt-2 space-y-1">
                  {[...s.entries].reverse().map((e) => (
                    <div key={e.id} className="text-xs font-mono flex gap-2">
                      <span className={entryTypeColor[e.type] ?? "text-gray-400"}>[{e.type}]</span>
                      <span className="text-muted-foreground truncate">{e.content}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Expanded: full detail */}
              {isExpanded && detail && (
                <div className="mt-3 border-t pt-3 space-y-3">
                  {detail.entries.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-xs font-semibold text-muted-foreground">Timeline ({detail.entries.length} entries)</p>
                      {detail.entries.map((e) => (
                        <div key={e.id} className="text-xs font-mono flex gap-2">
                          <span className="text-muted-foreground w-14 shrink-0">
                            {new Date(e.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </span>
                          <span className={`w-16 shrink-0 ${entryTypeColor[e.type] ?? "text-gray-400"}`}>[{e.type}]</span>
                          <span>{e.content}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {detail.tasks.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-xs font-semibold text-muted-foreground">Tasks ({detail.tasks.length})</p>
                      {detail.tasks.map((t) => (
                        <div key={t.id} className="text-xs flex items-center gap-2">
                          <Badge variant="outline" className="text-[10px]">{t.priority}</Badge>
                          <Badge variant={t.status === "done" ? "default" : "secondary"} className="text-[10px]">{t.status}</Badge>
                          <span>{t.title}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
      {sessions.length === 0 && <p className="text-center text-muted-foreground">No sessions yet. AI will create sessions via MCP.</p>}
    </div>
  );
}
