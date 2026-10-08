"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { IntentLink } from "@/components/IntentLink";
import { TopItemCard } from "@/components/TopItemCard";
import { CoverArt } from "@/components/CoverArt";
import { fmtListeningTime } from "@/lib/format";
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
  // null: no choice in the URL, so CSS picks list on phones and grid from md up.
  view: View | null;
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
      {view !== "list" && (
        <ul className={`${view === null ? "hidden md:grid" : "grid"} grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4`}>
          {items.map((item) => renderCard(item, kind, username))}
        </ul>
      )}
      {view !== "grid" && (
        <ol className={`divide-y divide-border ${view === null ? "md:hidden" : ""}`}>
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
        badge={ar.seen_count ? `Seen live ${ar.seen_count}×` : null}
      />
    </li>
  );
}

// Fixed width keeps covers lined up past rank 99.
const RANK = "w-7 shrink-0 text-center text-xs text-subtle-foreground tabular-nums";

function RowStats({ plays, effectiveMs }: { plays: number; effectiveMs: number }) {
  return (
    <span className="shrink-0 text-right tabular-nums leading-tight">
      <span className="block text-sm text-muted-foreground">{plays.toLocaleString()} plays</span>
      {effectiveMs > 0 && (
        <span className="block text-xs text-subtle-foreground">{fmtListeningTime(effectiveMs)}</span>
      )}
    </span>
  );
}

function renderRow(item: ListItem, kind: ListKind, username: string) {
  if (kind === "songs") {
    const s = item as TopSong;
    const href = songHref(username, s.recording_mbid, s.track_name, s.artist_name);
    const row = (
      <>
        <span className={RANK}>
          {s.rank}
        </span>
        <CoverArt
          art={{ caaId: s.caa_id, caaReleaseMbid: s.caa_release_mbid }}
          size={48}
          alt={s.track_name}
          className="rounded"
        />
        <div className="flex-1 min-w-0">
          <div className="truncate text-sm font-medium">{s.track_name}</div>
          <div className="truncate text-xs text-muted-foreground">{s.artist_name}</div>
        </div>
        <RowStats plays={s.plays} effectiveMs={Number(s.effective_ms)} />
      </>
    );
    return (
      <li key={`s-${s.rank}-${s.track_name}-${s.artist_name}`}>
        {href ? (
          <IntentLink
            href={href}
            className="flex items-center gap-3 py-2.5 hover:bg-muted active:bg-muted transition-colors -mx-2 px-2 rounded"
          >
            {row}
          </IntentLink>
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
        <span className={RANK}>
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
        <RowStats plays={a.plays} effectiveMs={Number(a.effective_ms)} />
      </>
    );
    return (
      <li key={`a-${a.rank}-${a.release_name}-${a.artist_name}`}>
        {href ? (
          <IntentLink href={href} className="flex items-center gap-3 py-2.5 hover:bg-muted active:bg-muted transition-colors -mx-2 px-2 rounded">
            {row}
          </IntentLink>
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
      <span className={RANK}>
        {ar.rank}
      </span>
      <CoverArt
        art={{ caaId: ar.caa_id, caaReleaseMbid: ar.caa_release_mbid }}
        size={48}
        alt={ar.artist_name}
        className="rounded-full"
      />
      <div className="flex-1 min-w-0">
        <div className="truncate text-sm font-medium">{ar.artist_name}</div>
        <div className="text-xs text-muted-foreground tabular-nums">
          {ar.distinct_tracks.toLocaleString()} songs · {ar.distinct_albums.toLocaleString()} albums
          {ar.seen_count > 0 && <span className="text-primary"> · seen live {ar.seen_count}×</span>}
        </div>
      </div>
      <RowStats plays={ar.plays} effectiveMs={Number(ar.effective_ms)} />
    </>
  );
  return (
    <li key={`ar-${ar.rank}-${ar.artist_name}`}>
      {href ? (
        <IntentLink href={href} className="flex items-center gap-3 py-2.5 hover:bg-muted active:bg-muted transition-colors -mx-2 px-2 rounded">
          {row}
        </IntentLink>
      ) : (
        <div className="flex items-center gap-3 py-2.5">{row}</div>
      )}
    </li>
  );
}
