import "dotenv/config";
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { db, schema, sqlClient } from "../lib/db/client";
import { loadArtistIndex } from "../lib/concerts/library";
import { toConcertRow, type RawConcert } from "../lib/concerts/importRow";

// Seeds a user's concerts from concert-history's concerts.json. Safe to re-run:
// upserts on (user, date, artist, venue); re-import only fills empty fields and
// never overwrites existing values (UI edits, artist link, festival grouping).
// Never creates festivals.
async function main() {
  const [username, path] = process.argv.slice(2);
  if (!username || !path) {
    console.error("usage: npx tsx scripts/import-concerts.ts <lb-username> <concerts.json>");
    process.exit(1);
  }
  const raw = JSON.parse(readFileSync(path, "utf8")) as { concerts: RawConcert[] };
  const index = await loadArtistIndex(username);
  const seen = new Set<string>();
  const rows = raw.concerts
    .map((c) => toConcertRow(username, c, index))
    .filter((r) => {
      const key = `${r.eventDate}|${r.artistName}|${r.venue ?? ""}`;
      if (seen.has(key)) {
        console.log(`Skipped duplicate: ${r.eventDate} ${r.artistName} @ ${r.venue ?? "(no venue)"}`);
        return false;
      }
      seen.add(key);
      return true;
    });

  const result = await db.transaction(async (tx) =>
    tx
      .insert(schema.concerts)
      .values(rows)
      .onConflictDoUpdate({
        target: [
          schema.concerts.userName,
          schema.concerts.eventDate,
          schema.concerts.artistName,
          schema.concerts.venue,
        ],
        set: {
          city: sql`coalesce(${schema.concerts.city}, excluded.city)`,
          country: sql`coalesce(${schema.concerts.country}, excluded.country)`,
          lat: sql`coalesce(${schema.concerts.lat}, excluded.lat)`,
          lng: sql`coalesce(${schema.concerts.lng}, excluded.lng)`,
          notes: sql`coalesce(${schema.concerts.notes}, excluded.notes)`,
          setlistUrl: sql`coalesce(${schema.concerts.setlistUrl}, excluded.setlist_url)`,
          confidence: sql`coalesce(${schema.concerts.confidence}, excluded.confidence)`,
          artistMbid: sql`coalesce(${schema.concerts.artistMbid}, excluded.artist_mbid)`,
          updatedAt: sql`now()`,
        },
      })
      .returning({ inserted: sql<boolean>`(xmax = 0)` }),
  );

  const inserted = result.filter((r) => r.inserted).length;
  console.log(`${rows.length} rows: ${inserted} inserted, ${rows.length - inserted} updated.`);
  const unmatched = [...new Set(rows.filter((r) => !r.artistMbid).map((r) => r.artistName))].sort();
  console.log(`\n${unmatched.length} artists not linked to your library:`);
  for (const name of unmatched) console.log(`  ${name}`);
  console.log(
    "\nCached artist pages pick this up after the next sync (or any account setting change).",
  );
  await sqlClient.end();
}

main().catch(async (e) => {
  console.error(e);
  await sqlClient.end();
  process.exit(1);
});
