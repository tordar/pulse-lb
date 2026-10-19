"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { SearchHits, buildGroups } from "@/components/SearchHits";
import { globalSearch } from "@/app/u/[username]/stats/actions";
import type { SearchResults } from "@/lib/db/queries/topItems";

const EMPTY: SearchResults = { artists: [], songs: [], albums: [] };

const SECTIONS: Record<string, { placeholder: string; group: string }> = {
  songs: { placeholder: "Search songs or artists…", group: "Songs" },
  albums: { placeholder: "Search albums or artists…", group: "Albums" },
  artists: { placeholder: "Search artists…", group: "Artists" },
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
 * The phone search screen: an opaque full-screen sheet with the field at the
 * top, the way Apple Music and Spotify search.
 *
 * It replaced a field docked above the keyboard. iOS pins position:fixed to
 * the layout viewport, so that dock had to chase the keyboard with
 * visualViewport and transforms — and wherever the chase came up short, or
 * behind the iOS 26 keyboard's glass, the page showed through. With the field
 * at the top nothing has to move, and the sheet covers the page entirely.
 *
 * The keyboard still overlaps the bottom of the sheet, so the results pad
 * themselves by its height to keep the last rows reachable. A wrong reading
 * there only costs some empty space; it can no longer uncover the page.
 *
 * On a list page the query also filters that list (?q=), which is what you
 * see after Done; the sheet shows only that section's matches meanwhile.
 */
export function SearchSheet({
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
  // The query `results` answer — until it catches up with the field, an empty
  // result means "not back yet", not "no matches".
  const [resultsFor, setResultsFor] = useState("");
  const [keyboard, setKeyboard] = useState(0);
  // Monotonic request id: a response only lands if no newer keystroke
  // superseded it.
  const seqRef = useRef(0);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // The page underneath must not scroll while the sheet covers it — iOS
  // otherwise scrolls it when a drag on the sheet runs out of results.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () =>
      setKeyboard(Math.max(0, window.innerHeight - (vv.offsetTop + vv.height)));
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
    if (!value.trim()) {
      seqRef.current++;
      setResults(EMPTY);
      setResultsFor("");
    }
  }

  useEffect(() => {
    const trimmed = q.trim();
    if (!trimmed) return;
    const seq = ++seqRef.current;
    const id = setTimeout(async () => {
      const r = await globalSearch(username, trimmed);
      if (seqRef.current !== seq) return;
      setResults(r);
      setResultsFor(trimmed);
    }, 250);
    return () => clearTimeout(id);
  }, [q, username]);

  const groups = buildGroups(username, results).filter(
    (g) => g.hits.length > 0 && (!section || g.label === SECTIONS[section].group),
  );
  const trimmed = q.trim();

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Search"
      className="md:hidden fixed inset-0 z-50 flex flex-col bg-background"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/60">
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
            placeholder={section ? SECTIONS[section].placeholder : "Search artists, songs & albums…"}
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
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 px-2 py-2 text-sm text-primary font-medium active:scale-95"
        >
          Done
        </button>
      </div>

      <div
        className="flex-1 overflow-y-auto overscroll-contain"
        style={{ paddingBottom: keyboard || "env(safe-area-inset-bottom)" }}
      >
        {!trimmed ? (
          <p className="px-4 py-6 text-sm text-subtle-foreground">
            {section ? `Filter your ${section} by name or artist.` : "Search your artists, songs and albums."}
          </p>
        ) : resultsFor !== trimmed && groups.length === 0 ? (
          <p className="px-4 py-6 text-sm text-subtle-foreground">Searching…</p>
        ) : (
          <SearchHits groups={groups} onPick={onClose} />
        )}
      </div>
    </div>
  );
}
