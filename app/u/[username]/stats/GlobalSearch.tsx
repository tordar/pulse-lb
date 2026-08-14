"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { SearchHits, buildGroups } from "@/components/SearchHits";
import type { SearchResults } from "@/lib/db/queries/topItems";
import { globalSearch } from "./actions";

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
    // Phones reach this same search from the tab bar's Search button, so the
    // inline field only exists from md up.
    <div ref={rootRef} className="relative hidden md:block w-full lg:w-96 lg:shrink-0">
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
          <SearchHits
            groups={groups}
            active={active}
            onHover={setActive}
            onPick={() => setOpen(false)}
          />
        </div>
      )}
    </div>
  );
}
