"use client";

import { useState, useTransition } from "react";
import type { Concert, Festival } from "@/lib/db/schema";
import { dateInRange } from "@/lib/concerts/form";
import { fetchSetlist } from "./actions";

// Paste a setlist.fm link → prefill the concert form for review. Nothing is
// saved until the user presses Save in that form.
export function SetlistImport({
  username, festivals, onLoaded,
}: {
  username: string;
  festivals: Festival[];
  onLoaded: (initial: Partial<Concert>) => void;
}) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const load = () =>
    start(async () => {
      setError(null);
      const r = await fetchSetlist(username, url);
      if (!r.ok) return setError(r.error);
      const v = r.value;
      const festival = v.eventName
        ? festivals.find(
            (f) => f.name.toLowerCase() === v.eventName!.toLowerCase() && dateInRange(v.eventDate, f.startDate, f.endDate),
          )
        : undefined;
      onLoaded({
        artistName: v.artistName,
        eventDate: v.eventDate,
        venue: v.venue,
        city: v.city,
        country: v.country,
        setlistUrl: v.setlistUrl,
        festivalId: festival?.id ?? null,
        notes: festival ? null : v.eventName,
      });
      setUrl("");
    });

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); load(); }}
      className="flex flex-wrap gap-2 items-center"
    >
      <input
        type="url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="Paste a setlist.fm link"
        className="flex-1 min-w-0 rounded-md border border-card-border bg-card px-2 py-1.5 text-sm"
      />
      <button type="submit" disabled={pending || !url.trim()}
        className="text-sm rounded-md border border-card-border px-3 py-1.5 disabled:opacity-60">
        {pending ? "Loading…" : "Fill from link"}
      </button>
      {error && <p className="basis-full text-sm text-red-600" role="alert">{error}</p>}
    </form>
  );
}
