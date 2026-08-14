"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { SearchHits, buildGroups } from "@/components/SearchHits";
import { globalSearch } from "@/app/u/[username]/stats/actions";
import type { SearchResults } from "@/lib/db/queries/topItems";

const EMPTY: SearchResults = { artists: [], songs: [], albums: [] };

const SECTIONS: Record<string, string> = {
  songs: "Search songs or artists…",
  albums: "Search albums or artists…",
  artists: "Search artists…",
};

/**
 * Which search the Search button runs, decided by where you are: on a list
 * page it filters that list (the same ?q= the desktop SearchBox writes), and
 * anywhere else it searches everything, like the stats page's combobox.
 */
export function searchSection(pathname: string | null, username: string): string | null {
  const base = `/u/${encodeURIComponent(username)}`;
  const section = pathname?.startsWith(`${base}/`) ? pathname.slice(base.length + 1) : "";
  return section in SECTIONS ? section : null;
}

/**
 * The phone search field, docked where the tab bar was.
 *
 * iOS pins position:fixed to the layout viewport, so a bottom-docked field
 * would sit *behind* the keyboard. visualViewport tells us how much of the
 * screen the keyboard took; we lift the dock by exactly that much.
 */
export function SearchDock({
  username,
  onClose,
}: {
  username: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const section = searchSection(pathname, username);
  const [q, setQ] = useState(section ? (params.get("q") ?? "") : "");
  const [results, setResults] = useState<SearchResults>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [keyboard, setKeyboard] = useState(0);
  // Monotonic request id: a response only lands if no newer keystroke
  // superseded it.
  const seqRef = useRef(0);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () =>
      setKeyboard(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  // List page: write ?q= and let the server re-render the list behind us.
  useEffect(() => {
    if (!section) return;
    const id = setTimeout(() => {
      const next = new URLSearchParams(params);
      const trimmed = q.trim();
      if (trimmed) next.set("q", trimmed);
      else next.delete("q");
      next.delete("page");
      router.replace(`${pathname}${next.toString() ? `?${next}` : ""}`, { scroll: false });
    }, 250);
    return () => clearTimeout(id);
    // `params` is a fresh object each render; keying off q alone is the point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, section]);

  // Emptying the field drops the hits straight away — waiting for an effect
  // would leave stale results under an empty query for a frame.
  function onQueryChange(value: string) {
    setQ(value);
    if (!section && !value.trim()) {
      seqRef.current++;
      setResults(EMPTY);
      setLoading(false);
    }
  }

  // Everywhere else: search artists, songs and albums at once.
  useEffect(() => {
    if (section) return;
    const trimmed = q.trim();
    if (!trimmed) return;
    const seq = ++seqRef.current;
    const id = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await globalSearch(username, trimmed);
        if (seqRef.current !== seq) return;
        setResults(r);
      } finally {
        if (seqRef.current === seq) setLoading(false);
      }
    }, 250);
    return () => clearTimeout(id);
  }, [q, section, username]);

  const groups = buildGroups(username, results);
  const showHits = !section && q.trim().length > 0;

  return (
    <div
      className="flex flex-col"
      style={keyboard ? { transform: `translateY(-${keyboard}px)` } : undefined}
    >
      {showHits && (
        // Denser than the bar itself: rows have to stay readable over whatever
        // page is showing through the glass behind them.
        <div className="max-h-[45vh] overflow-y-auto border-b border-white/10 bg-background/90">
          <SearchHits groups={groups} onPick={onClose} />
        </div>
      )}

      <div className="flex items-center gap-2 px-3 py-2">
        <div className="relative flex-1">
          <Search
            size={15}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle-foreground pointer-events-none"
          />
          <input
            ref={inputRef}
            type="search"
            value={q}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && onClose()}
            enterKeyHint="search"
            aria-label={section ? `Search ${section}` : "Search artists, songs and albums"}
            placeholder={section ? SECTIONS[section] : "Search artists, songs & albums…"}
            // The webkit cancel button is suppressed because we render our own
            // ✕ — otherwise the field carries two clear buttons side by side.
            className="w-full border border-border bg-card rounded-full pl-9 pr-9 py-2 text-base placeholder:text-subtle-foreground focus:outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/40 [&::-webkit-search-cancel-button]:appearance-none"
          />
          {q && (
            <button
              type="button"
              onClick={() => {
                onQueryChange("");
                inputRef.current?.focus();
              }}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-subtle-foreground active:scale-90"
            >
              <X size={16} />
            </button>
          )}
          {loading && !q && (
            <span className="absolute right-9 top-1/2 -translate-y-1/2 text-xs text-subtle-foreground">
              …
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 px-2 py-2 text-sm text-primary font-medium active:scale-95"
        >
          Done
        </button>
      </div>
    </div>
  );
}
