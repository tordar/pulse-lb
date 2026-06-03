import { sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { withRetry } from "@/lib/db/retry";

const PAGE_SIZE = 50;

export type ListPageOpts = { username: string; query: string; page: number };
export type ListPageResult<T> = { items: T[]; page: number; pageSize: number; hasMore: boolean };

function searchPattern(query: string): string | null {
  const q = query.trim();
  if (!q) return null;
  return `%${q.replace(/[\\%_]/g, (c) => "\\" + c)}%`;
}

export type TopSong = {
  rank: number;
  track_name: string;
  artist_name: string;
  plays: number;
  effective_ms: number;
  caa_id: number | null;
  caa_release_mbid: string | null;
  recording_mbid: string | null;
};

export async function topSongs(opts: ListPageOpts): Promise<ListPageResult<TopSong>> {
  const pat = searchPattern(opts.query);
  const offset = opts.page * PAGE_SIZE;
  const limit = PAGE_SIZE + 1;
  // ROW_NUMBER is computed over the FULL user/scope set ordered by plays —
  // matching the unfiltered list's order — so each item's rank is stable
  // regardless of the search filter applied in the outer query.
  const rows = await withRetry(() =>
    db.execute<TopSong>(sql`
      SELECT rank, track_name, artist_name, plays, effective_ms,
             caa_id, caa_release_mbid, recording_mbid
      FROM (
        SELECT
          ROW_NUMBER() OVER (ORDER BY plays DESC, track_name)::int AS rank,
          track_name, artist_name, plays, effective_ms,
          caa_id, caa_release_mbid, recording_mbid
        FROM ${schema.aggSong}
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

export type TopAlbum = {
  rank: number;
  release_name: string;
  artist_name: string;
  plays: number;
  effective_ms: number;
  caa_id: number | null;
  caa_release_mbid: string | null;
  release_mbid: string | null;
};

export async function topAlbums(opts: ListPageOpts): Promise<ListPageResult<TopAlbum>> {
  const pat = searchPattern(opts.query);
  const offset = opts.page * PAGE_SIZE;
  const limit = PAGE_SIZE + 1;
  const rows = await withRetry(() =>
    db.execute<TopAlbum>(sql`
      SELECT rank, release_name, artist_name, plays, effective_ms,
             caa_id, caa_release_mbid, release_mbid
      FROM (
        SELECT
          ROW_NUMBER() OVER (ORDER BY plays DESC, release_name)::int AS rank,
          release_name, artist_name, plays, effective_ms,
          caa_id, caa_release_mbid, release_mbid
        FROM ${schema.aggAlbum}
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

export type TopArtist = {
  rank: number;
  artist_name: string;
  plays: number;
  effective_ms: number;
  distinct_tracks: number;
  distinct_albums: number;
  artist_mbid: string | null;
  caa_id: number | null;
  caa_release_mbid: string | null;
};

export async function topArtists(opts: ListPageOpts): Promise<ListPageResult<TopArtist>> {
  const pat = searchPattern(opts.query);
  const offset = opts.page * PAGE_SIZE;
  const limit = PAGE_SIZE + 1;
  const rows = await withRetry(() =>
    db.execute<TopArtist>(sql`
      SELECT rank, artist_name, plays, effective_ms,
             distinct_tracks, distinct_albums,
             artist_mbid, caa_id, caa_release_mbid
      FROM (
        SELECT
          ROW_NUMBER() OVER (ORDER BY plays DESC, artist_name)::int AS rank,
          artist_name, plays, effective_ms,
          distinct_songs AS distinct_tracks,
          distinct_albums,
          artist_mbid, caa_id, caa_release_mbid
        FROM ${schema.aggArtist}
        WHERE user_name = ${opts.username} AND scope = 0
      ) ranked
      WHERE ${pat ? sql`artist_name ILIKE ${pat}` : sql`TRUE`}
      ORDER BY rank
      LIMIT ${limit} OFFSET ${offset}
    `),
  );
  const items = (rows as unknown as { rows: TopArtist[] }).rows;
  return paginate(items, opts.page);
}

function paginate<T>(rows: T[], page: number): ListPageResult<T> {
  const hasMore = rows.length > PAGE_SIZE;
  return { items: hasMore ? rows.slice(0, PAGE_SIZE) : rows, page, pageSize: PAGE_SIZE, hasMore };
}
