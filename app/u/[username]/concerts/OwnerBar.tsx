"use client";

import type { Festival } from "@/lib/db/schema";
import { ConcertForm } from "./ConcertForm";
import { FestivalForm } from "./FestivalForm";
import { SetlistImport } from "./SetlistImport";
import { useEditMode } from "./EditMode";

export function OwnerBar({ username, festivals }: { username: string; festivals: Festival[] }) {
  const { editMode, setEditMode, editing, setEditing, close } = useEditMode();
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setEditing({ kind: "new-concert" })}
          className="text-sm rounded-md bg-primary text-primary-foreground px-3 py-1.5">Add concert</button>
        <button type="button" onClick={() => setEditing({ kind: "new-festival" })}
          className="text-sm rounded-md border border-card-border px-3 py-1.5">Add festival</button>
        <button type="button" onClick={() => setEditMode(!editMode)} aria-pressed={editMode}
          className={`text-sm rounded-md border border-card-border px-3 py-1.5 ml-auto ${editMode ? "bg-muted" : ""}`}>
          {editMode ? "Done" : "Edit"}
        </button>
      </div>
      <SetlistImport username={username} festivals={festivals}
        onLoaded={(initial) => setEditing({ kind: "from-setlist", initial })} />
      {editing?.kind === "new-concert" && <ConcertForm username={username} festivals={festivals} onDone={close} />}
      {editing?.kind === "from-setlist" && (
        <ConcertForm key={`${editing.initial.setlistUrl}`} username={username} festivals={festivals}
          initial={editing.initial} onDone={close} />
      )}
      {editing?.kind === "new-festival" && <FestivalForm username={username} onDone={close} />}
    </div>
  );
}
