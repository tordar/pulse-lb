import { sql, type SQL } from "drizzle-orm";
import { db, schema, execute, sqlClient } from "@/lib/db/client";
import { userCached, userCachedFor } from "./cache";
import { withRetry } from "@/lib/db/retry";
import { artistKeyExpr, withArtistSetAlbumClusters } from "@/lib/db/aggregates/albumCluster";

const PAGE_SIZE = 50;

export type ListPageOpts = { username: string; query: string; page: number; movement?: boolean };

// Present only when the list was asked for movement: plays in the last 30
// days, and the item's rank 30 days ago (null when it had no plays then).
export type Movement = { recent_plays?: number; rank_then?: number | null };

const RECENT = sql.raw(`now() - interval '30 days'`);

// Columns for an inner ranked select joined to a `recent (…, n)` relation.
// The rank 30 days ago orders by the plays the item had then, the same way the
// list orders by plays now; items with no plays then get no rank.
function movementCols(nameCol: string): SQL {
  return sql.raw(`,
    COALESCE(recent.n, 0)::int AS recent_plays,
    (CASE WHEN plays > COALESCE(recent.n, 0) THEN ROW_NUMBER() OVER (
      PARTITION BY plays > COALESCE(recent.n, 0)
      ORDER BY plays - COALESCE(recent.n, 0) DESC, ${nameCol}) END)::int AS rank_then`);
}

export type ListPageResult<T> = { items: T[]; page: number; pageSize: number; hasMore: boolean };

function searchPattern(query: string): string | null {
  const q = query.trim();
  if (!q) return null;
  return `%${q.replace(/[\\%_]/g, (c) => "\\" + c)}%`;
}

export type TopSong = Movement & {
  rank: number;
  track_name: string;
  artist_name: string;
  plays: number;
  effective_ms: number;
  caa_id: number | null;
  caa_release_mbid: string | null;
  recording_mbid: string | null;
};

async function topSongsUncached(opts: ListPageOpts): Promise<ListPageResult<TopSong>> {
  const pat = searchPattern(opts.query);
  const offset = opts.page * PAGE_SIZE;
  const limit = PAGE_SIZE + 1;
  // ROW_NUMBER is computed over the FULL user/scope set ordered by plays —
  // matching the unfiltered list's order — so each item's rank is stable
  // regardless of the search filter applied in the outer query.
  const rows = await withRetry(() =>
    execute<TopSong>(sql`
      SELECT rank, track_name, artist_name, plays, effective_ms,
             caa_id, caa_release_mbid, recording_mbid
             ${opts.movement ? sql`, recent_plays, rank_then` : sql``}
      FROM (
        SELECT
          ROW_NUMBER() OVER (ORDER BY plays DESC, track_name)::int AS rank,
          track_name, artist_name, plays, effective_ms,
          caa_id, caa_release_mbid, recording_mbid
          ${opts.movement ? movementCols("track_name") : sql``}
        FROM ${schema.aggSong}
        ${opts.movement ? sql`LEFT JOIN (
          SELECT COALESCE(recording_mbid::text, '~' || track_name) || '|' || COALESCE(artist_name, '') AS group_key,
                 COUNT(*)::int AS n
          FROM ${schema.listens}
          WHERE user_name = ${opts.username} AND listened_at >= ${RECENT}
          GROUP BY 1
        ) recent USING (group_key)` : sql``}
        WHERE user_name = ${opts.username} AND scope = 0
      ) ranked
      WHERE ${pat ? sql`(track_name ILIKE ${pat} OR artist_name ILIKE ${pat})` : sql`TRUE`}
      ORDER BY rank
      LIMIT ${limit} OFFSET ${offset}
    `),
  );
  const items = (rows as unknown as { rows: TopSong[] }).rows;
  return paginate(items, opts.page);
}

export type TopAlbum = Movement & {
  rank: number;
  release_name: string;
  artist_name: string;
  plays: number;
  effective_ms: number;
  caa_id: number | null;
  caa_release_mbid: string | null;
  release_mbid: string | null;
};

async function topAlbumsUncached(opts: ListPageOpts): Promise<ListPageResult<TopAlbum>> {
  const pat = searchPattern(opts.query);
  const offset = opts.page * PAGE_SIZE;
  const limit = PAGE_SIZE + 1;
  const recent = opts.movement ? await recentAlbumPlays(opts.username) : null;
  const rows = await withRetry(() =>
    execute<TopAlbum>(sql`
      SELECT rank, release_name, artist_name, plays, effective_ms,
             caa_id, caa_release_mbid, release_mbid
             ${recent ? sql`, recent_plays, rank_then` : sql``}
      FROM (
        SELECT
          ROW_NUMBER() OVER (ORDER BY plays DESC, release_name)::int AS rank,
          release_name, artist_name, plays, effective_ms,
          caa_id, caa_release_mbid, release_mbid
          ${recent ? movementCols("release_name") : sql``}
        FROM ${schema.aggAlbum}
        ${recent ? sql`LEFT JOIN (
          SELECT key AS group_key, value::int AS n FROM jsonb_each_text(${JSON.stringify(recent)}::jsonb)
        ) recent USING (group_key)` : sql``}
        WHERE user_name = ${opts.username} AND scope = 0
      ) ranked
      WHERE ${pat ? sql`(release_name ILIKE ${pat} OR artist_name ILIKE ${pat})` : sql`TRUE`}
      ORDER BY rank
      LIMIT ${limit} OFFSET ${offset}
    `),
  );
  const items = (rows as unknown as { rows: TopAlbum[] }).rows;
  return paginate(items, opts.page);
}

export type TopArtist = Movement & {
  rank: number;
  artist_name: string;
  plays: number;
  effective_ms: number;
  distinct_tracks: number;
  distinct_albums: number;
  artist_mbid: string | null;
  caa_id: number | null;
  caa_release_mbid: string | null;
  seen_count: number;
};

async function topArtistsUncached(opts: ListPageOpts): Promise<ListPageResult<TopArtist>> {
  const pat = searchPattern(opts.query);
  const offset = opts.page * PAGE_SIZE;
  const limit = PAGE_SIZE + 1;
  const rows = await withRetry(() =>
    execute<TopArtist>(sql`
      SELECT ranked.rank, ranked.artist_name, ranked.plays, ranked.effective_ms,
             ranked.distinct_tracks, ranked.distinct_albums,
             ranked.artist_mbid, ranked.caa_id, ranked.caa_release_mbid,
             COALESCE(seen.n, 0)::int AS seen_count
             ${opts.movement ? sql`, ranked.recent_plays, ranked.rank_then` : sql``}
      FROM (
        SELECT
          ROW_NUMBER() OVER (ORDER BY plays DESC, artist_name)::int AS rank,
          artist_name, plays, effective_ms,
          distinct_songs AS distinct_tracks,
          distinct_albums,
          artist_mbid, caa_id, caa_release_mbid
          ${opts.movement ? movementCols("artist_name") : sql``}
        FROM ${schema.aggArtist}
        ${opts.movement ? sql`LEFT JOIN (
          SELECT ${sql.raw(artistKeyExpr("l"))} AS artist_key, COUNT(*)::int AS n
          FROM ${schema.listens} l
          WHERE l.user_name = ${opts.username} AND l.artist_name IS NOT NULL AND l.listened_at >= ${RECENT}
          GROUP BY 1
        ) recent USING (artist_key)` : sql``}
        WHERE user_name = ${opts.username} AND scope = 0
      ) ranked
      LEFT JOIN (
        SELECT artist_mbid, count(*) AS n
        FROM ${schema.concerts}
        WHERE user_name = ${opts.username} AND artist_mbid IS NOT NULL
        GROUP BY artist_mbid
      ) seen ON seen.artist_mbid = ranked.artist_mbid
      WHERE ${pat ? sql`ranked.artist_name ILIKE ${pat}` : sql`TRUE`}
      ORDER BY ranked.rank
      LIMIT ${limit} OFFSET ${offset}
    `),
  );
  const items = (rows as unknown as { rows: TopArtist[] }).rows;
  return paginate(items, opts.page);
}

// Last-30-day plays per album cluster. Clusters are decided over an artist's
// whole history, so this clusters every listen of the artists played lately,
// passing every spelling they're credited under (see withArtistSetAlbumClusters).
async function recentAlbumPlays(username: string): Promise<Record<string, number>> {
  const played = await withRetry(() => sqlClient<{ artist_name: string }[]>`
    SELECT DISTINCT artist_name FROM listens
    WHERE user_name = ${username} AND listened_at >= now() - interval '30 days' AND artist_name IS NOT NULL`);
  if (played.length === 0) return {};
  const lowered = [...new Set(played.map((r) => r.artist_name.toLowerCase()))];
  const spelled = await withRetry(() => sqlClient<{ artist_name: string }[]>`
    SELECT DISTINCT n AS artist_name FROM agg_artist, unnest(artist_names) AS n
    WHERE user_name = ${username} AND scope = 0 AND lower(n) = ANY(${lowered}::text[])`);
  const names = [...new Set([...played, ...spelled].map((r) => r.artist_name))];
  const rows = (await withRetry(() =>
    sqlClient.unsafe(
      withArtistSetAlbumClusters(`
        SELECT cluster_key, COUNT(*)::int AS n FROM clustered
        WHERE listened_at >= now() - interval '30 days'
        GROUP BY cluster_key`),
      [username, names],
    ),
  )) as unknown as { cluster_key: string; n: number }[];
  return Object.fromEntries(rows.map((r) => [r.cluster_key, r.n]));
}

function paginate<T>(rows: T[], page: number): ListPageResult<T> {
  const hasMore = rows.length > PAGE_SIZE;
  return { items: hasMore ? rows.slice(0, PAGE_SIZE) : rows, page, pageSize: PAGE_SIZE, hasMore };
}

const SEARCH_LIMIT = 5;

export type SearchArtist = {
  artist_name: string;
  plays: number;
  artist_mbid: string | null;
  caa_id: number | null;
  caa_release_mbid: string | null;
};
export type SearchSong = {
  track_name: string;
  artist_name: string;
  plays: number;
  recording_mbid: string | null;
  caa_id: number | null;
  caa_release_mbid: string | null;
};
export type SearchAlbum = {
  release_name: string;
  artist_name: string;
  plays: number;
  release_mbid: string | null;
  caa_id: number | null;
  caa_release_mbid: string | null;
};
export type SearchResults = {
  artists: SearchArtist[];
  songs: SearchSong[];
  albums: SearchAlbum[];
};

// Cross-entity search for the stats dashboard's global search dropdown: top
// matches per kind, ordered by plays like the top lists.
async function searchAllUncached(username: string, query: string): Promise<SearchResults> {
  const pat = searchPattern(query);
  if (!pat) return { artists: [], songs: [], albums: [] };
  const [artists, songs, albums] = await Promise.all([
    withRetry(() =>
      execute<SearchArtist>(sql`
        SELECT artist_name, plays, artist_mbid, caa_id, caa_release_mbid
        FROM ${schema.aggArtist}
        WHERE user_name = ${username} AND scope = 0 AND artist_name ILIKE ${pat}
        ORDER BY plays DESC, artist_name
        LIMIT ${SEARCH_LIMIT}
      `),
    ),
    withRetry(() =>
      execute<SearchSong>(sql`
        SELECT track_name, artist_name, plays, recording_mbid, caa_id, caa_release_mbid
        FROM ${schema.aggSong}
        WHERE user_name = ${username} AND scope = 0
          AND (track_name ILIKE ${pat} OR artist_name ILIKE ${pat})
        ORDER BY plays DESC, track_name
        LIMIT ${SEARCH_LIMIT}
      `),
    ),
    withRetry(() =>
      execute<SearchAlbum>(sql`
        SELECT release_name, artist_name, plays, release_mbid, caa_id, caa_release_mbid
        FROM ${schema.aggAlbum}
        WHERE user_name = ${username} AND scope = 0
          AND (release_name ILIKE ${pat} OR artist_name ILIKE ${pat})
        ORDER BY plays DESC, release_name
        LIMIT ${SEARCH_LIMIT}
      `),
    ),
  ]);
  return {
    artists: (artists as unknown as { rows: SearchArtist[] }).rows,
    songs: (songs as unknown as { rows: SearchSong[] }).rows,
    albums: (albums as unknown as { rows: SearchAlbum[] }).rows,
  };
}

/*
 * Public read API. Every list a visitor (or a crawler) can reach is served from
 * the per-user tag cache first — see ./cache. The uncached bodies above stay
 * private so nothing can accidentally route around it and wake Neon.
 */

export function topSongs(opts: ListPageOpts): Promise<ListPageResult<TopSong>> {
  return listCached(opts, "topSongs", () => topSongsUncached(opts));
}

export function topAlbums(opts: ListPageOpts): Promise<ListPageResult<TopAlbum>> {
  return listCached(opts, "topAlbums", () => topAlbumsUncached(opts));
}

export function topArtists(opts: ListPageOpts): Promise<ListPageResult<TopArtist>> {
  return listCached(opts, "topArtists", () => topArtistsUncached(opts));
}

// The 30-day window slides without any new listen to drop the tag, so lists
// with movement also expire hourly.
function listCached<T>(opts: ListPageOpts, name: string, fn: () => Promise<T>): Promise<T> {
  const keys = [name, opts.username, opts.query, opts.page];
  return opts.movement
    ? userCachedFor(opts.username, [...keys, "movement"], 3600, fn)
    : userCached(opts.username, keys, fn);
}

export function searchAll(username: string, query: string): Promise<SearchResults> {
  return userCached(username, ["searchAll", username, query], () =>
    searchAllUncached(username, query),
  );
}
