import { and, asc, desc, eq, getTableColumns } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import type { Concert, Festival } from "@/lib/db/schema";
import { userCached } from "./cache";
import { withRetry } from "@/lib/db/retry";

export type ArtistConcert = Concert & { festivalName: string | null };

export function concertsTimeline(
  username: string,
): Promise<{ concerts: Concert[]; festivals: Festival[] }> {
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
    return { concerts, festivals };
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
