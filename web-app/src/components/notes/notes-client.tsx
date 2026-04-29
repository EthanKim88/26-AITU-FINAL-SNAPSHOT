"use client";

import { useState, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Trash2, Plus, Pencil, X, Check } from "lucide-react";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/fetcher";

interface NoteData {
  id: string; content: string; tags: string; host: string; createdAt: string; updatedAt: string;
}

export function NotesClient({ initialNotes }: { initialNotes: NoteData[] }) {
  const [notes, setNotes] = useState(initialNotes);
  const [newContent, setNewContent] = useState("");
  const [newTags, setNewTags] = useState("");
  const [newHost, setNewHost] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");

  const refresh = useCallback(async () => {
    const data = await apiGet<NoteData[]>("/api/notes");
    setNotes(data);
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newContent.trim()) return;
    await apiPost("/api/notes", { content: newContent.trim(), tags: newTags, host: newHost });
    setNewContent(""); setNewTags(""); setNewHost("");
    refresh();
  };

  const handleDelete = async (noteId: string) => {
    await apiDelete(`/api/notes/${noteId}`);
    refresh();
  };

  const startEdit = (note: NoteData) => {
    setEditingId(note.id);
    setEditContent(note.content);
  };

  const handleSaveEdit = async (noteId: string) => {
    await apiPatch(`/api/notes/${noteId}`, { content: editContent });
    setEditingId(null);
    refresh();
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-4">
          <form onSubmit={handleAdd} className="space-y-3">
            <Textarea placeholder="Write a note..." value={newContent} onChange={(e) => setNewContent(e.target.value)} rows={3} />
            <div className="flex gap-2">
              <Input placeholder="Tags (comma-separated)" value={newTags} onChange={(e) => setNewTags(e.target.value)} className="flex-1" />
              <Input placeholder="Host IP" value={newHost} onChange={(e) => setNewHost(e.target.value)} className="w-36" />
              <Button type="submit" disabled={!newContent.trim()}><Plus className="mr-1 h-4 w-4" />Add</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {notes.map((n) => (
          <Card key={n.id}>
            <CardContent className="pt-4">
              {editingId === n.id ? (
                <div className="space-y-2">
                  <Textarea value={editContent} onChange={(e) => setEditContent(e.target.value)} rows={3} />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => handleSaveEdit(n.id)}><Check className="mr-1 h-3 w-3" />Save</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}><X className="mr-1 h-3 w-3" />Cancel</Button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="whitespace-pre-wrap text-sm">{n.content}</p>
                  <div className="mt-2 flex items-center gap-2">
                    {n.tags && n.tags.split(",").map((t) => t.trim()).filter(Boolean).map((t) => (
                      <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>
                    ))}
                    {n.host && <Badge variant="secondary" className="text-[10px] font-mono">{n.host}</Badge>}
                    <span className="flex-1" />
                    <span className="text-xs text-muted-foreground">{new Date(n.updatedAt).toLocaleString()}</span>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => startEdit(n)}><Pencil className="h-3 w-3" /></Button>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleDelete(n.id)}><Trash2 className="h-3 w-3 text-destructive" /></Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        ))}
        {notes.length === 0 && <p className="text-center text-muted-foreground">No notes yet.</p>}
      </div>
    </div>
  );
}
