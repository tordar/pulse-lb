"use client";

import Link from "next/link";
import { CoverArt } from "@/components/CoverArt";
import type { SearchResults } from "@/lib/db/queries/topItems";

export type Hit = {
  key: string;
  href: string | null;
  art: { caaId: number | null; caaReleaseMbid: string | null };
  artShape: "square" | "circle";
  title: string;
  subtitle: string;
  plays: number;
};

export type Group = { label: string; hits: Hit[] };

/**
 * Grouped result rows, shared by the desktop combobox (<GlobalSearch>) and the
 * phone search dock. `active` is the keyboard-highlighted index against the
 * flattened hit list — touch callers just leave it at -1.
 */
export function SearchHits({
  groups,
  active = -1,
  onHover,
  onPick,
}: {
  groups: Group[];
  active?: number;
  onHover?: (index: number) => void;
  onPick?: () => void;
}) {
  const flat = groups.flatMap((g) => g.hits);

  if (flat.length === 0) {
    return <p className="px-3 py-3 text-sm text-subtle-foreground">No matches.</p>;
  }

  return (
    <>
      {groups.map((g) => (
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
              const rowClass = `flex items-center gap-3 px-3 py-1.5 active:bg-muted ${
                idx === active ? "bg-muted" : ""
              }`;
              return (
                <li key={hit.key} onMouseEnter={() => onHover?.(idx)}>
                  {hit.href ? (
                    <Link href={hit.href} className={rowClass} onClick={onPick}>
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
      ))}
    </>
  );
}

export function buildGroups(username: string, results: SearchResults): Group[] {
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
