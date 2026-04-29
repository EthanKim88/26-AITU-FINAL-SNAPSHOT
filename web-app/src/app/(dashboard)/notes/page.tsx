import { prisma } from "@/lib/prisma";
import { NotesClient } from "@/components/notes/notes-client";

export default async function NotesPage() {
  const notes = await prisma.note.findMany({
    orderBy: { updatedAt: "desc" },
  });

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Notes</h1>
      <NotesClient initialNotes={JSON.parse(JSON.stringify(notes))} />
    </div>
  );
}
