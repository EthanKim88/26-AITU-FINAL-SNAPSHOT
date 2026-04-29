"use client";

import { useState, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { KeyRound, Monitor, Zap, Clock, AlertTriangle, StickyNote, Search } from "lucide-react";
import { useEventStream } from "@/hooks/use-event-stream";

interface EventData {
  id: string; type: string; category: string; source: string;
  message: string; data: string; host: string; createdAt: string;
}

const typeIcons: Record<string, React.ReactNode> = {
  credential: <KeyRound className="h-4 w-4 text-yellow-400" />,
  discovery: <Monitor className="h-4 w-4 text-blue-400" />,
  exploit: <Zap className="h-4 w-4 text-red-400" />,
  scan: <Search className="h-4 w-4 text-purple-400" />,
  error: <AlertTriangle className="h-4 w-4 text-orange-400" />,
  note: <StickyNote className="h-4 w-4 text-teal-400" />,
};

const typeColors: Record<string, string> = {
  credential: "bg-yellow-900/20 border-yellow-800",
  discovery: "bg-blue-900/20 border-blue-800",
  exploit: "bg-red-900/20 border-red-800",
  error: "bg-orange-900/20 border-orange-800",
};

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function TimelineClient({ initialEvents }: { initialEvents: EventData[] }) {
  const streamEvents = useEventStream();
  const [filterType, setFilterType] = useState("all");
  const [filterCat, setFilterCat] = useState("all");

  // Merge initial + stream (deduplicate by id)
  const allEvents = useMemo(() => {
    const map = new Map<string, EventData>();
    for (const e of initialEvents) map.set(e.id, e);
    for (const e of streamEvents) map.set(e.id, e);
    return [...map.values()].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [initialEvents, streamEvents]);

  const filtered = allEvents.filter((e) => {
    if (filterType !== "all" && e.type !== filterType) return false;
    if (filterCat !== "all" && e.category !== filterCat) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <Select value={filterType} onValueChange={(v) => v && setFilterType(v)}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {["discovery", "credential", "exploit", "pivot", "scan", "error", "decision", "note"].map((t) => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterCat} onValueChange={(v) => v && setFilterCat(v)}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {["web", "ad", "scada", "general"].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="self-center text-sm text-muted-foreground">{filtered.length} events</span>
      </div>

      <div className="space-y-2">
        {filtered.map((ev) => (
          <div key={ev.id} className={`flex items-start gap-3 rounded border p-3 ${typeColors[ev.type] ?? "border-border"}`}>
            <div className="mt-0.5">{typeIcons[ev.type] ?? <Clock className="h-4 w-4 text-muted-foreground" />}</div>
            <div className="min-w-0 flex-1">
              <p className="text-sm">{ev.message}</p>
              <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-mono">{formatTime(ev.createdAt)}</span>
                {ev.host && <span>{ev.host}</span>}
                <Badge variant="outline" className="text-[10px] px-1 py-0">{ev.type}</Badge>
                <Badge variant="outline" className="text-[10px] px-1 py-0">{ev.category}</Badge>
                {ev.source && <span>via {ev.source}</span>}
              </div>
            </div>
          </div>
        ))}
        {filtered.length === 0 && <p className="text-muted-foreground text-center py-8">No events</p>}
      </div>
    </div>
  );
}
