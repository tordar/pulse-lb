"use client";

import { useActionState, useEffect } from "react";
import type { Festival } from "@/lib/db/schema";
import { saveFestival, type FormState } from "./actions";

const input = "w-full rounded-md border border-card-border bg-card px-2 py-1.5 text-sm";

export function FestivalForm({
  username, initial, onDone,
}: { username: string; initial?: Partial<Festival>; onDone: () => void }) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    saveFestival.bind(null, username),
    { error: null, savedAt: null },
  );
  useEffect(() => {
    if (state.savedAt) onDone();
  }, [state.savedAt, onDone]);

  return (
    <form key={state.nonce ?? 0} action={action} className="grid gap-2 sm:grid-cols-2 p-3 rounded-lg border border-card-border bg-card">
      <input type="hidden" name="id" defaultValue={state.values?.id ?? initial?.id ?? ""} />
      <label className="text-xs space-y-1 sm:col-span-2">Name
        <input name="name" required defaultValue={state.values?.name ?? initial?.name ?? ""} className={input} placeholder="Øya 2019" />
      </label>
      <label className="text-xs space-y-1">Start
        <input name="startDate" type="date" required defaultValue={state.values?.startDate ?? initial?.startDate ?? ""} className={input} />
      </label>
      <label className="text-xs space-y-1">End
        <input name="endDate" type="date" required defaultValue={state.values?.endDate ?? initial?.endDate ?? ""} className={input} />
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
      <label className="text-xs space-y-1 sm:col-span-2">Poster image link
        <input name="posterUrl" type="url" placeholder="https://…/poster.jpg"
          defaultValue={state.values?.posterUrl ?? initial?.posterUrl ?? ""} className={input} />
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
