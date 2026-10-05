"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import type { Concert, Festival } from "@/lib/db/schema";
import { saveConcert, searchLibraryArtists, type FormState } from "./actions";

const input = "w-full rounded-md border border-card-border bg-card px-2 py-1.5 text-sm";

export function ConcertForm({
  username, festivals, initial, onDone,
}: {
  username: string;
  festivals: Festival[];
  initial?: Partial<Concert>;
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    saveConcert.bind(null, username),
    { error: null, savedAt: null },
  );
  const listId = useId();
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (state.savedAt) onDone();
  }, [state.savedAt, onDone]);

  const onArtistInput = (q: string) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => searchLibraryArtists(username, q).then(setSuggestions), 200);
  };

  return (
    <form key={state.nonce ?? 0} action={action} className="grid gap-2 sm:grid-cols-2 p-3 rounded-lg border border-card-border bg-card">
      <input type="hidden" name="id" defaultValue={state.values?.id ?? initial?.id ?? ""} />
      <label className="text-xs space-y-1">Artist
        <input name="artistName" required list={listId} defaultValue={state.values?.artistName ?? initial?.artistName ?? ""}
          onChange={(e) => onArtistInput(e.target.value)} className={input} autoComplete="off" />
        <datalist id={listId}>{suggestions.map((s) => <option key={s} value={s} />)}</datalist>
      </label>
      <label className="text-xs space-y-1">Date
        <input name="eventDate" type="date" required defaultValue={state.values?.eventDate ?? initial?.eventDate ?? ""} className={input} />
      </label>
      <label className="text-xs space-y-1">Venue
        <input name="venue" defaultValue={state.values?.venue ?? initial?.venue ?? ""} className={input} />
      </label>
      <label className="text-xs space-y-1">City
        <input name="city" defaultValue={state.values?.city ?? initial?.city ?? ""} className={input} />
      </label>
      <label className="text-xs space-y-1">Country
        <input name="country" defaultValue={state.values?.country ?? initial?.country ?? ""} className={input} />
      </label>
      <label className="text-xs space-y-1">Festival
        <select name="festivalId" defaultValue={state.values?.festivalId ?? initial?.festivalId ?? ""} className={input}>
          <option value="">None</option>
          {festivals.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      </label>
      <label className="text-xs space-y-1">Setlist link
        <input name="setlistUrl" type="url" defaultValue={state.values?.setlistUrl ?? initial?.setlistUrl ?? ""} className={input} />
      </label>
      <label className="text-xs space-y-1 sm:col-span-2">Notes
        <textarea name="notes" rows={2} defaultValue={state.values?.notes ?? initial?.notes ?? ""} className={input} />
      </label>
      {state.error && <p className="sm:col-span-2 text-sm text-red-600" role="alert">{state.error}</p>}
      <div className="sm:col-span-2 flex gap-2 justify-end">
        <button type="button" onClick={onDone} className="text-sm text-muted-foreground px-3 py-1.5">Cancel</button>
        <button type="submit" disabled={pending}
          className="text-sm rounded-md bg-primary text-primary-foreground px-3 py-1.5 disabled:opacity-60">
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}
