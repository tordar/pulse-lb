import { sql } from "drizzle-orm";
import { schema, execute } from "@/lib/db/client";
import { withRetry } from "@/lib/db/retry";
import { buildArtistIndex, type ArtistIndex } from "./match";

export async function loadArtistIndex(username: string): Promise<ArtistIndex> {
  const { rows } = await withRetry(() =>
    execute<{ artist_name: string; artist_mbid: string; plays: number }>(sql`
      SELECT artist_name, artist_mbid, plays
      FROM ${schema.aggArtist}
      WHERE user_name = ${username} AND scope = 0 AND artist_mbid IS NOT NULL
    `),
  );
  return buildArtistIndex(
    rows.map((r) => ({ artistName: r.artist_name, mbid: r.artist_mbid, plays: Number(r.plays) })),
  );
}
