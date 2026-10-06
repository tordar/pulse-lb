import { and, asc, desc, eq, getTableColumns, sql } from "drizzle-orm";
import { db, schema, execute } from "@/lib/db/client";
import type { CoverArtRef } from "@/lib/listenbrainz/coverArt";
import type { Concert, Festival } from "@/lib/db/schema";
import { userCached } from "./cache";
import { withRetry } from "@/lib/db/retry";

export type ArtistConcert = Concert & { festivalName: string | null };

export type ConcertsTimeline = {
  concerts: Concert[];
  festivals: Festival[];
  // Artist image per linked artist, keyed by MBID — the same cover art the
  // Artists page shows (the artist's most-played release).
  art: Record<string, CoverArtRef>;
};

export function concertsTimeline(username: string): Promise<ConcertsTimeline> {
  return userCached(username, ["concertsTimeline", username], async () => {
    const [concerts, festivals] = await Promise.all([
      withRetry(() =>
        db.select().from(schema.concerts).where(eq(schema.concerts.userName, username))
          .orderBy(desc(schema.concerts.eventDate)),
      ),
      withRetry(() =>
        db.select().from(schema.festivals).where(eq(schema.festivals.userName, username))
          .orderBy(desc(schema.festivals.startDate)),
      ),
    ]);
    const { rows } = await withRetry(() =>
      execute<{ artist_mbid: string; caa_id: number | null; caa_release_mbid: string | null }>(sql`
        SELECT DISTINCT ON (a.artist_mbid) a.artist_mbid, a.caa_id, a.caa_release_mbid
        FROM ${schema.aggArtist} a
        JOIN ${schema.concerts} c ON c.artist_mbid = a.artist_mbid AND c.user_name = a.user_name
        WHERE a.user_name = ${username} AND a.scope = 0 AND a.caa_id IS NOT NULL
        ORDER BY a.artist_mbid, a.plays DESC
      `),
    );
    const art: Record<string, CoverArtRef> = {};
    for (const r of rows) art[r.artist_mbid] = { caaId: Number(r.caa_id), caaReleaseMbid: r.caa_release_mbid };
    return { concerts, festivals, art };
  });
}

export function concertsForArtist(username: string, artistMbid: string): Promise<ArtistConcert[]> {
  return userCached(username, ["concertsForArtist", username, artistMbid], () =>
    withRetry(() =>
      db
        .select({ ...getTableColumns(schema.concerts), festivalName: schema.festivals.name })
        .from(schema.concerts)
        .leftJoin(schema.festivals, eq(schema.festivals.id, schema.concerts.festivalId))
        .where(and(eq(schema.concerts.userName, username), eq(schema.concerts.artistMbid, artistMbid)))
        .orderBy(asc(schema.concerts.eventDate)),
    ),
  );
}

export type TopSeen = { top: number; seen: number }[];

const TOP_TIERS = [500];

// How many of the user's top 500 artists (as ranked on Top Artists) they've seen
// live at least once.
export function topArtistsSeen(username: string): Promise<TopSeen> {
  return userCached(username, ["topArtistsSeen", username], async () => {
    const { rows } = await withRetry(() =>
      execute<{ rank: number; seen: boolean }>(sql`
        SELECT ranked.rank, EXISTS (
          SELECT 1 FROM ${schema.concerts} c
          WHERE c.user_name = ${username} AND c.artist_mbid = ranked.artist_mbid
        ) AS seen
        FROM (
          SELECT artist_mbid, ROW_NUMBER() OVER (ORDER BY plays DESC, artist_name)::int AS rank
          FROM ${schema.aggArtist}
          WHERE user_name = ${username} AND scope = 0
        ) ranked
        WHERE ranked.rank <= ${Math.max(...TOP_TIERS)}
      `),
    );
    return TOP_TIERS.filter((n) => rows.length >= n).map((top) => ({
      top,
      seen: rows.filter((r) => Number(r.rank) <= top && r.seen).length,
    }));
  });
}
