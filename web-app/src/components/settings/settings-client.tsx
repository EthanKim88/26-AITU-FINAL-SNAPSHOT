"use client";

import { useState, useCallback } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Trash2, Plus } from "lucide-react";
import { apiPost, apiDelete, apiGet } from "@/lib/fetcher";

interface Segment {
  id: string;
  name: string;
  cidr: string;
  description: string;
  order: number;
  scope?: string;
  ownerHost?: { id: string; ip: string; hostname: string } | null;
}

export function SettingsClient({ initialSegments }: {
  initialSegments: Segment[];
}) {
  const [segments, setSegments] = useState(initialSegments);

  // Segment add form
  const [segName, setSegName] = useState("");
  const [segCidr, setSegCidr] = useState("");
  const [segDesc, setSegDesc] = useState("");

  const refreshSegments = useCallback(async () => {
    const data = await apiGet<Segment[]>("/api/segments");
    setSegments(data);
  }, []);

  const handleAddSegment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!segName.trim()) return;
    await apiPost("/api/segments", {
      name: segName.trim(), cidr: segCidr, description: segDesc, order: segments.length,
    });
    setSegName(""); setSegCidr(""); setSegDesc("");
    refreshSegments();
  };

  const handleDeleteSegment = async (segmentId: string) => {
    await apiDelete(`/api/segments/${segmentId}`);
    refreshSegments();
  };

  return (
    <div className="space-y-6">
      {/* Segments */}
      <Card>
        <CardHeader><CardTitle>Network Segments</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Scope</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>CIDR</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Order</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {segments.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell>{s.scope === "host-local" ? "host-local" : "global"}</TableCell>
                  <TableCell className="font-mono text-xs">{s.scope === "host-local" ? (s.ownerHost?.ip ?? "unknown-host") : "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{s.cidr}</TableCell>
                  <TableCell className="text-sm">{s.description}</TableCell>
                  <TableCell>{s.order}</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDeleteSegment(s.id)}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {segments.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No segments</TableCell></TableRow>
              )}
            </TableBody>
          </Table>

          <form onSubmit={handleAddSegment} className="flex gap-2">
            <Input placeholder="Name (e.g. DMZ)" value={segName} onChange={(e) => setSegName(e.target.value)} className="w-32" />
            <Input placeholder="CIDR" value={segCidr} onChange={(e) => setSegCidr(e.target.value)} className="w-40" />
            <Input placeholder="Description" value={segDesc} onChange={(e) => setSegDesc(e.target.value)} className="flex-1" />
            <Button type="submit" disabled={!segName.trim()} size="icon"><Plus className="h-4 w-4" /></Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
