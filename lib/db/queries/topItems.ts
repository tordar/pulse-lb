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
  track_name: string;
  artist_name: string;
  plays: number;
  caa_id: number | null;
  caa_release_mbid: string | null;
  recording_mbid: string | null;
};

export async function topSongs(opts: ListPageOpts): Promise<ListPageResult<TopSong>> {
  const pat = searchPattern(opts.query);
  const offset = opts.page * PAGE_SIZE;
  const limit = PAGE_SIZE + 1;
  const rows = await withRetry(() =>
    db.execute<TopSong>(sql`
      SELECT
        track_name,
        artist_name,
        COUNT(*)::int AS plays,
        (array_agg(caa_id ORDER BY listened_at DESC) FILTER (WHERE caa_id IS NOT NULL))[1] AS caa_id,
        (array_agg(caa_release_mbid ORDER BY listened_at DESC) FILTER (WHERE caa_release_mbid IS NOT NULL))[1] AS caa_release_mbid,
        (array_agg(recording_mbid ORDER BY listened_at DESC) FILTER (WHERE recording_mbid IS NOT NULL))[1] AS recording_mbid
      FROM ${schema.listens}
      WHERE user_name = ${opts.username}
        ${pat ? sql`AND (track_name ILIKE ${pat} OR artist_name ILIKE ${pat})` : sql``}
      GROUP BY track_name, artist_name
      ORDER BY plays DESC, track_name
      LIMIT ${limit} OFFSET ${offset}
    `),
  );
  const items = (rows as unknown as { rows: TopSong[] }).rows;
  return paginate(items, opts.page);
}

export type TopAlbum = {
  release_name: string;
  artist_name: string;
  plays: number;
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
      SELECT
        release_name,
        artist_name,
        COUNT(*)::int AS plays,
        (array_agg(caa_id ORDER BY listened_at DESC) FILTER (WHERE caa_id IS NOT NULL))[1] AS caa_id,
        (array_agg(caa_release_mbid ORDER BY listened_at DESC) FILTER (WHERE caa_release_mbid IS NOT NULL))[1] AS caa_release_mbid,
        (array_agg(release_mbid ORDER BY listened_at DESC) FILTER (WHERE release_mbid IS NOT NULL))[1] AS release_mbid
      FROM ${schema.listens}
      WHERE user_name = ${opts.username} AND release_name IS NOT NULL
        ${pat ? sql`AND (release_name ILIKE ${pat} OR artist_name ILIKE ${pat})` : sql``}
      GROUP BY release_name, artist_name
      ORDER BY plays DESC, release_name
      LIMIT ${limit} OFFSET ${offset}
    `),
  );
  const items = (rows as unknown as { rows: TopAlbum[] }).rows;
  return paginate(items, opts.page);
}

export type TopArtist = {
  artist_name: string;
  plays: number;
  distinct_tracks: number;
  distinct_albums: number;
  artist_mbid: string | null;
};

export async function topArtists(opts: ListPageOpts): Promise<ListPageResult<TopArtist>> {
  const pat = searchPattern(opts.query);
  const offset = opts.page * PAGE_SIZE;
  const limit = PAGE_SIZE + 1;
  const rows = await withRetry(() =>
    db.execute<TopArtist>(sql`
      SELECT
        artist_name,
        COUNT(*)::int AS plays,
        COUNT(DISTINCT track_name)::int AS distinct_tracks,
        COUNT(DISTINCT release_name)::int AS distinct_albums,
        (array_agg(artist_mbids[1] ORDER BY listened_at DESC) FILTER (WHERE artist_mbids[1] IS NOT NULL))[1]::text AS artist_mbid
      FROM ${schema.listens}
      WHERE user_name = ${opts.username} AND artist_name IS NOT NULL
        ${pat ? sql`AND artist_name ILIKE ${pat}` : sql``}
      GROUP BY artist_name
      ORDER BY plays DESC, artist_name
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
