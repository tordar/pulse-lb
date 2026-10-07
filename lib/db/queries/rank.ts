import { sql, type SQL } from "drizzle-orm";
import { schema, execute } from "@/lib/db/client";
import { withRetry } from "@/lib/db/retry";
import { userCached } from "./cache";

type Row<T> = { rows: T[] };

/**
 * All-time rank on the detail pages, ranked exactly like the top lists in
 * ./topItems (plays desc, then name) so a page and its list never disagree.
 * One mbid can sit on several aggregate rows (spelling variants, editions);
 * the best-ranked one wins.
 */
async function rankOf(
  table: SQL,
  nameCol: SQL,
  mbidCol: SQL,
  username: string,
  mbid: string,
): Promise<number | null> {
  const res = await withRetry(() =>
    execute<{ rank: number }>(sql`
      SELECT min(rank)::int AS rank
      FROM (
        SELECT ROW_NUMBER() OVER (ORDER BY plays DESC, ${nameCol}) AS rank, ${mbidCol} AS mbid
        FROM ${table}
        WHERE user_name = ${username} AND scope = 0
      ) ranked
      WHERE mbid = ${mbid}::uuid
    `),
  );
  return (res as unknown as Row<{ rank: number | null }>).rows[0]?.rank ?? null;
}

export function artistRank(username: string, artistMbid: string): Promise<number | null> {
  return userCached(username, ["artistRank", username, artistMbid], () =>
    rankOf(sql`${schema.aggArtist}`, sql`artist_name`, sql`artist_mbid`, username, artistMbid),
  );
}

export function albumRank(username: string, releaseMbid: string): Promise<number | null> {
  return userCached(username, ["albumRank", username, releaseMbid], () =>
    rankOf(sql`${schema.aggAlbum}`, sql`release_name`, sql`release_mbid`, username, releaseMbid),
  );
}

export function songRank(username: string, recordingMbid: string): Promise<number | null> {
  return userCached(username, ["songRank", username, recordingMbid], () =>
    rankOf(sql`${schema.aggSong}`, sql`track_name`, sql`recording_mbid`, username, recordingMbid),
  );
}
