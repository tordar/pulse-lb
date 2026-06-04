"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Search } from "lucide-react";
import { CoverArt } from "@/components/CoverArt";
import type { SearchResults } from "@/lib/db/queries/topItems";
import { globalSearch } from "./actions";

type Hit = {
  key: string;
  href: string | null;
  art: { caaId: number | null; caaReleaseMbid: string | null };
  artShape: "square" | "circle";
  title: string;
  subtitle: string;
  plays: number;
};

type Group = { label: string; hits: Hit[] };

const EMPTY: SearchResults = { artists: [], songs: [], albums: [] };

export function GlobalSearch({ username }: { username: string }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResults>(EMPTY);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  // Monotonic request id: a response only lands if no newer keystroke
  // superseded it (covers both the debounce window and in-flight requests).
  const seqRef = useRef(0);

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    setQ(value);
    if (!value.trim()) {
      seqRef.current++;
      setResults(EMPTY);
      setOpen(false);
      setLoading(false);
    }
  }

  useEffect(() => {
    const trimmed = q.trim();
    if (!trimmed) return;
    const seq = ++seqRef.current;
    const id = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await globalSearch(username, trimmed);
        if (seqRef.current !== seq) return;
        setResults(r);
        setActive(-1);
        setOpen(true);
      } finally {
        if (seqRef.current === seq) setLoading(false);
      }
    }, 250);
    return () => clearTimeout(id);
  }, [q, username]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const groups = buildGroups(username, results);
  const flat = groups.flatMap((g) => g.hits);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!flat.length) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      const delta = e.key === "ArrowDown" ? 1 : -1;
      setActive((prev) => (prev + delta + flat.length) % flat.length);
    } else if (e.key === "Enter" && open && active >= 0) {
      const href = flat[active]?.href;
      if (href) {
        e.preventDefault();
        setOpen(false);
        router.push(href);
      }
    }
  }

  return (
    <div ref={rootRef} className="relative w-full lg:w-96 lg:shrink-0">
      <Search
        size={15}
        className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle-foreground pointer-events-none"
      />
      <input
        type="search"
        role="combobox"
        aria-expanded={open}
        aria-controls="global-search-results"
        aria-label="Search artists, songs and albums"
        value={q}
        onChange={onChange}
        onFocus={() => q.trim() && setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Search artists, songs & albums…"
        className="w-full border border-border bg-card rounded-md pl-9 pr-8 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary placeholder:text-subtle-foreground"
      />
      {loading && (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-subtle-foreground">…</span>
      )}
      {open && (
        <div
          id="global-search-results"
          className="absolute left-0 right-0 top-full mt-1 z-40 rounded-md border border-border bg-card shadow-lg max-h-96 overflow-y-auto"
        >
          {flat.length === 0 ? (
            <p className="px-3 py-3 text-sm text-subtle-foreground">No matches.</p>
          ) : (
            groups.map((g) => (
              <div key={g.label}>
                <p className="px-3 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {g.label}
                </p>
                <ul className="pb-1">
                  {g.hits.map((hit) => {
                    const idx = flat.indexOf(hit);
                    const row = (
                      <>
                        <CoverArt
                          art={hit.art}
                          size={36}
                          alt={hit.title}
                          className={hit.artShape === "circle" ? "rounded-full" : "rounded"}
                        />
                        <span className="flex-1 min-w-0">
                          <span className="block truncate text-sm">{hit.title}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {hit.subtitle}
                          </span>
                        </span>
                        <span className="shrink-0 text-xs tabular-nums text-subtle-foreground">
                          {hit.plays.toLocaleString()} plays
                        </span>
                      </>
                    );
                    const rowClass = `flex items-center gap-3 px-3 py-1.5 ${idx === active ? "bg-muted" : ""}`;
                    return (
                      <li key={hit.key} onMouseEnter={() => setActive(idx)}>
                        {hit.href ? (
                          <Link href={hit.href} className={rowClass} onClick={() => setOpen(false)}>
                            {row}
                          </Link>
                        ) : (
                          <div className={rowClass}>{row}</div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function buildGroups(username: string, results: SearchResults): Group[] {
  const u = encodeURIComponent(username);
  const groups: Group[] = [
    {
      label: "Artists",
      hits: results.artists.map((a) => ({
        key: `ar-${a.artist_name}`,
        href: a.artist_mbid
          ? `/u/${u}/artists/${a.artist_mbid}?${new URLSearchParams({ name: a.artist_name, artist: a.artist_name })}`
          : null,
        art: { caaId: a.caa_id, caaReleaseMbid: a.caa_release_mbid },
        artShape: "circle" as const,
        title: a.artist_name,
        subtitle: "Artist",
        plays: a.plays,
      })),
    },
    {
      label: "Songs",
      hits: results.songs.map((s) => ({
        key: `s-${s.track_name}-${s.artist_name}`,
        href: s.recording_mbid
          ? `/u/${u}/songs/${s.recording_mbid}?${new URLSearchParams({ name: s.track_name, artist: s.artist_name })}`
          : null,
        art: { caaId: s.caa_id, caaReleaseMbid: s.caa_release_mbid },
        artShape: "square" as const,
        title: s.track_name,
        subtitle: s.artist_name,
        plays: s.plays,
      })),
    },
    {
      label: "Albums",
      hits: results.albums.map((a) => ({
        key: `al-${a.release_name}-${a.artist_name}`,
        href: a.release_mbid
          ? `/u/${u}/albums/${a.release_mbid}?${new URLSearchParams({ name: a.release_name, artist: a.artist_name })}`
          : null,
        art: { caaId: a.caa_id, caaReleaseMbid: a.caa_release_mbid },
        artShape: "square" as const,
        title: a.release_name,
        subtitle: a.artist_name,
        plays: a.plays,
      })),
    },
  ];
  return groups.filter((g) => g.hits.length > 0);
}
