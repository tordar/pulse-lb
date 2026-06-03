"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { TopItemCard } from "@/components/TopItemCard";
import { CoverArt } from "@/components/CoverArt";
import type { View } from "@/components/ViewToggle";
import type {
  TopSong,
  TopAlbum,
  TopArtist,
} from "@/lib/db/queries/topItems";
import {
  fetchListPage,
  type ListKind,
  type ListItem,
} from "./actions";

export function InfiniteList({
  kind,
  view,
  username,
  query,
  initialItems,
  initialHasMore,
}: {
  kind: ListKind;
  view: View;
  username: string;
  query: string;
  initialItems: ListItem[];
  initialHasMore: boolean;
}) {
  const [items, setItems] = useState<ListItem[]>(initialItems);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loading, setLoading] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // If the upstream props change (filter, view, kind), reset the local
  // state so we start over from the new server-rendered first page.
  useEffect(() => {
    setItems(initialItems);
    setPage(0);
    setHasMore(initialHasMore);
  }, [initialItems, initialHasMore]);

  const loadMore = useCallback(async () => {
    if (loading || !hasMore) return;
    setLoading(true);
    try {
      const next = page + 1;
      const result = await fetchListPage(kind, username, query, next);
      setItems((prev) => [...prev, ...result.items]);
      setPage(next);
      setHasMore(result.hasMore);
    } finally {
      setLoading(false);
    }
  }, [loading, hasMore, page, kind, username, query]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMore();
      },
      { rootMargin: "400px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, loadMore]);

  return (
    <>
      {view === "grid" ? (
        <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {items.map((item) => renderCard(item, kind, username))}
        </ul>
      ) : (
        <ol className="divide-y divide-border">
          {items.map((item) => renderRow(item, kind, username))}
        </ol>
      )}
      {hasMore && (
        <div
          ref={sentinelRef}
          className="h-12 flex items-center justify-center text-xs text-subtle-foreground"
        >
          {loading ? "loading…" : ""}
        </div>
      )}
    </>
  );
}

function songHref(
  username: string,
  recordingMbid: string | null,
  name: string,
  artist: string,
): string | null {
  if (!recordingMbid) return null;
  const qs = new URLSearchParams({ name, artist }).toString();
  return `/u/${encodeURIComponent(username)}/songs/${recordingMbid}?${qs}`;
}

function albumHref(
  username: string,
  releaseMbid: string | null,
  name: string,
  artist: string,
): string | null {
  if (!releaseMbid) return null;
  const qs = new URLSearchParams({ name, artist }).toString();
  return `/u/${encodeURIComponent(username)}/albums/${releaseMbid}?${qs}`;
}

function artistHref(username: string, artistMbid: string | null): string | null {
  if (!artistMbid) return null;
  return `/u/${encodeURIComponent(username)}/artists/${artistMbid}`;
}

function renderCard(item: ListItem, kind: ListKind, username: string) {
  if (kind === "songs") {
    const s = item as TopSong;
    return (
      <li key={`s-${s.rank}-${s.track_name}-${s.artist_name}`}>
        <TopItemCard
          rank={s.rank}
          art={{ caaId: s.caa_id, caaReleaseMbid: s.caa_release_mbid }}
          title={s.track_name}
          subtitle={s.artist_name}
          plays={s.plays}
          effectiveMs={Number(s.effective_ms)}
          href={songHref(username, s.recording_mbid, s.track_name, s.artist_name)}
        />
      </li>
    );
  }
  if (kind === "albums") {
    const a = item as TopAlbum;
    return (
      <li key={`a-${a.rank}-${a.release_name}-${a.artist_name}`}>
        <TopItemCard
          rank={a.rank}
          art={{ caaId: a.caa_id, caaReleaseMbid: a.caa_release_mbid }}
          title={a.release_name}
          subtitle={a.artist_name}
          plays={a.plays}
          effectiveMs={Number(a.effective_ms)}
          href={albumHref(username, a.release_mbid, a.release_name, a.artist_name)}
        />
      </li>
    );
  }
  const ar = item as TopArtist;
  return (
    <li key={`ar-${ar.rank}-${ar.artist_name}`}>
      <TopItemCard
        rank={ar.rank}
        art={{ caaId: ar.caa_id, caaReleaseMbid: ar.caa_release_mbid }}
        artShape="circle"
        title={ar.artist_name}
        subtitle={`${ar.distinct_tracks.toLocaleString()} songs · ${ar.distinct_albums.toLocaleString()} albums`}
        plays={ar.plays}
        effectiveMs={Number(ar.effective_ms)}
        href={artistHref(username, ar.artist_mbid)}
      />
    </li>
  );
}

function renderRow(item: ListItem, kind: ListKind, username: string) {
  if (kind === "songs") {
    const s = item as TopSong;
    const href = songHref(username, s.recording_mbid, s.track_name, s.artist_name);
    const row = (
      <>
        <span className="w-8 text-right text-sm text-subtle-foreground tabular-nums">
          {s.rank}
        </span>
        <CoverArt
          art={{ caaId: s.caa_id, caaReleaseMbid: s.caa_release_mbid }}
          size={40}
          alt={s.track_name}
          className="rounded"
        />
        <div className="flex-1 min-w-0">
          <div className="truncate text-sm font-medium">{s.track_name}</div>
          <div className="truncate text-xs text-muted-foreground">{s.artist_name}</div>
        </div>
        <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
          {s.plays.toLocaleString()} plays
        </span>
      </>
    );
    return (
      <li key={`s-${s.rank}-${s.track_name}-${s.artist_name}`}>
        {href ? (
          <Link
            href={href}
            className="flex items-center gap-3 py-2.5 hover:bg-muted -mx-2 px-2 rounded"
          >
            {row}
          </Link>
        ) : (
          <div className="flex items-center gap-3 py-2.5">{row}</div>
        )}
      </li>
    );
  }
  if (kind === "albums") {
    const a = item as TopAlbum;
    const href = albumHref(username, a.release_mbid, a.release_name, a.artist_name);
    const row = (
      <>
        <span className="w-8 text-right text-sm text-subtle-foreground tabular-nums">
          {a.rank}
        </span>
        <CoverArt
          art={{ caaId: a.caa_id, caaReleaseMbid: a.caa_release_mbid }}
          size={48}
          alt={a.release_name}
          className="rounded"
        />
        <div className="flex-1 min-w-0">
          <div className="truncate text-sm font-medium">{a.release_name}</div>
          <div className="truncate text-xs text-muted-foreground">{a.artist_name}</div>
        </div>
        <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
          {a.plays.toLocaleString()} plays
        </span>
      </>
    );
    return (
      <li key={`a-${a.rank}-${a.release_name}-${a.artist_name}`}>
        {href ? (
          <Link href={href} className="flex items-center gap-3 py-2.5 hover:bg-muted -mx-2 px-2 rounded">
            {row}
          </Link>
        ) : (
          <div className="flex items-center gap-3 py-2.5">{row}</div>
        )}
      </li>
    );
  }
  const ar = item as TopArtist;
  const href = artistHref(username, ar.artist_mbid);
  const row = (
    <>
      <span className="w-8 text-right text-sm text-subtle-foreground tabular-nums">
        {ar.rank}
      </span>
      <div className="flex-1 min-w-0">
        <div className="truncate text-sm font-medium">{ar.artist_name}</div>
        <div className="text-xs text-muted-foreground tabular-nums">
          {ar.distinct_tracks.toLocaleString()} songs · {ar.distinct_albums.toLocaleString()} albums
        </div>
      </div>
      <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
        {ar.plays.toLocaleString()} plays
      </span>
    </>
  );
  return (
    <li key={`ar-${ar.rank}-${ar.artist_name}`}>
      {href ? (
        <Link href={href} className="flex items-center gap-3 py-3 hover:bg-muted -mx-2 px-2 rounded">
          {row}
        </Link>
      ) : (
        <div className="flex items-center gap-3 py-3">{row}</div>
      )}
    </li>
  );
}
