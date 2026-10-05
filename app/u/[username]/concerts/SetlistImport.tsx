"use client";

import { useMemo, useState, useTransition } from "react";
import type { Concert, Festival } from "@/lib/db/schema";
import { dateInRange } from "@/lib/concerts/form";
import { normalizeArtist } from "@/lib/concerts/match";
import { fmtConcertDate } from "@/lib/concerts/format";
import type { SetlistHit } from "@/lib/concerts/setlistfm";
import { fetchSetlist, searchSetlistFm } from "./actions";

const input = "rounded-md border border-card-border bg-card px-2 py-1.5 text-sm";
const button = "text-sm rounded-md border border-card-border px-3 py-1.5 disabled:opacity-60";

function toInitial(v: SetlistHit, festivals: Festival[]): Partial<Concert> {
  const festival = v.eventName
    ? festivals.find(
        (f) => f.name.toLowerCase() === v.eventName!.toLowerCase() && dateInRange(v.eventDate, f.startDate, f.endDate),
      )
    : undefined;
  return {
    artistName: v.artistName,
    eventDate: v.eventDate,
    venue: v.venue,
    city: v.city,
    country: v.country,
    setlistUrl: v.setlistUrl,
    festivalId: festival?.id ?? null,
    notes: festival ? null : v.eventName,
  };
}

// Find a show on setlist.fm (search, or paste its link) → prefill the concert
// form for review. Nothing is saved until the user presses Save in that form.
export function SetlistImport({
  username, festivals, concerts, onLoaded,
}: {
  username: string;
  festivals: Festival[];
  concerts: Concert[];
  onLoaded: (initial: Partial<Concert>) => void;
}) {
  const [artist, setArtist] = useState("");
  const [year, setYear] = useState("");
  const [hits, setHits] = useState<SetlistHit[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const added = useMemo(() => {
    const keys = new Set<string>();
    for (const c of concerts) {
      keys.add(`${c.eventDate}|${normalizeArtist(c.artistName)}`);
      if (c.setlistUrl) keys.add(c.setlistUrl);
    }
    return keys;
  }, [concerts]);
  const isAdded = (h: SetlistHit) =>
    added.has(h.setlistUrl) || added.has(`${h.eventDate}|${normalizeArtist(h.artistName)}`);

  const search = (nextPage: number) =>
    start(async () => {
      setError(null);
      const r = await searchSetlistFm(username, artist, year, nextPage);
      if (!r.ok) return setError(r.error);
      setHits(nextPage === 1 ? r.items : [...(hits ?? []), ...r.items]);
      setTotal(r.total);
      setPage(nextPage);
      setHasMore(r.hasMore);
    });

  const loadUrl = () =>
    start(async () => {
      setError(null);
      const r = await fetchSetlist(username, url);
      if (!r.ok) return setError(r.error);
      onLoaded(toInitial(r.value, festivals));
      setUrl("");
    });

  return (
    <div className="space-y-2">
      <form onSubmit={(e) => { e.preventDefault(); search(1); }} className="flex flex-wrap gap-2 items-center">
        <input value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="Search setlist.fm by artist"
          className={`${input} flex-1 min-w-0`} />
        <input value={year} onChange={(e) => setYear(e.target.value)} placeholder="Year" inputMode="numeric"
          maxLength={4} className={`${input} w-20`} />
        <button type="submit" disabled={pending || artist.trim().length < 2} className={button}>
          {pending ? "Searching…" : "Search"}
        </button>
      </form>

      <form onSubmit={(e) => { e.preventDefault(); loadUrl(); }} className="flex flex-wrap gap-2 items-center">
        <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="…or paste a setlist.fm link"
          className={`${input} flex-1 min-w-0`} />
        <button type="submit" disabled={pending || !url.trim()} className={button}>Fill from link</button>
      </form>

      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}

      {hits && (
        <div className="rounded-lg border border-card-border bg-card">
          <div className="flex items-center justify-between px-3 py-2 text-xs text-muted-foreground">
            <span>{total === 0 ? "No shows found." : `${total.toLocaleString()} shows`}</span>
            <button type="button" onClick={() => setHits(null)} className="hover:text-foreground">Close</button>
          </div>
          <ul className="divide-y divide-border max-h-96 overflow-y-auto">
            {hits.map((h) => {
              const done = isAdded(h);
              return (
                <li key={h.setlistUrl}>
                  <button type="button" disabled={done}
                    onClick={() => { onLoaded(toInitial(h, festivals)); setHits(null); }}
                    className="w-full flex gap-3 items-baseline px-3 py-2 text-sm text-left hover:bg-muted disabled:hover:bg-transparent disabled:opacity-60">
                    <span className="w-24 shrink-0 text-xs text-subtle-foreground tabular-nums">{fmtConcertDate(h.eventDate)}</span>
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-medium">{h.artistName}</span>
                      <span className="text-subtle-foreground"> · {[h.venue, h.city, h.country].filter(Boolean).join(", ")}</span>
                    </span>
                    {done && <span className="shrink-0 text-xs text-primary">Added</span>}
                  </button>
                </li>
              );
            })}
          </ul>
          {hasMore && (
            <div className="px-3 py-2">
              <button type="button" disabled={pending} onClick={() => search(page + 1)} className={button}>
                {pending ? "Loading…" : "More"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
