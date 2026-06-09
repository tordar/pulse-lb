import "dotenv/config";
import postgres from "postgres";

const USER = process.argv[2] ?? "tordar";
const PAGE_SIZE = 1000;
const LB = "https://api.listenbrainz.org";

type RG = {
  release_group_mbid: string;
  release_group_name: string;
  artist_name: string;
  listen_count: number;
};

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });

  const [before] = await sql`
    SELECT
      COUNT(*) FILTER (WHERE release_group_mbid IS NOT NULL)::int AS have,
      COUNT(*)::int AS total
    FROM listens WHERE user_name = ${USER}
  `;
  console.log(
    `Before: ${before.have.toLocaleString()}/${before.total.toLocaleString()} listens have release_group_mbid (${((before.have / before.total) * 100).toFixed(2)}%)`,
  );

  const t0 = Date.now();
  let apiCalls = 0;
  let pagedGroups = 0;
  let totalUpdated = 0;
  let offset = 0;

  while (true) {
    apiCalls++;
    const url = `${LB}/1/stats/user/${USER}/release-groups?range=all_time&count=${PAGE_SIZE}&offset=${offset}`;
    const r = await fetch(url);
    if (!r.ok) {
      console.error(`HTTP ${r.status} at offset ${offset}; stopping`);
      break;
    }
    const j = (await r.json()) as { payload: { release_groups: RG[] } };
    const groups = j.payload?.release_groups ?? [];
    if (groups.length === 0) break;
    pagedGroups += groups.length;

    // Batched UPDATE: one round-trip per page using UNNEST of parallel arrays.
    const usable = groups.filter((g) => g.release_group_mbid && g.release_group_name && g.artist_name);
    if (usable.length > 0) {
      const rgids = usable.map((g) => g.release_group_mbid);
      const artists = usable.map((g) => g.artist_name);
      const names = usable.map((g) => g.release_group_name);
      const result = await sql`
        WITH src AS (
          SELECT * FROM UNNEST(
            ${rgids}::uuid[],
            ${artists}::text[],
            ${names}::text[]
          ) AS t(rgid, artist, name)
        )
        UPDATE listens l
        SET release_group_mbid = src.rgid
        FROM src
        WHERE l.user_name = ${USER}
          AND l.artist_name = src.artist
          AND l.release_name = src.name
          AND l.release_group_mbid IS NULL
        RETURNING 1
      `;
      totalUpdated += result.length;
    }

    console.log(`  page ${apiCalls}: +${groups.length} groups (offset=${offset}), updates so far: ${totalUpdated.toLocaleString()}`);

    if (groups.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  const [after] = await sql`
    SELECT
      COUNT(*) FILTER (WHERE release_group_mbid IS NOT NULL)::int AS have,
      COUNT(*)::int AS total
    FROM listens WHERE user_name = ${USER}
  `;

  const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
  console.log();
  console.log("=== Backfill summary ===");
  console.log(`Wall-clock:        ${elapsed}s`);
  console.log(`LB API calls:      ${apiCalls}`);
  console.log(`Release-groups:    ${pagedGroups.toLocaleString()} unique`);
  console.log(`Listens updated:   ${totalUpdated.toLocaleString()}`);
  console.log(`Coverage before:   ${((before.have / before.total) * 100).toFixed(2)}% (${before.have.toLocaleString()}/${before.total.toLocaleString()})`);
  console.log(`Coverage after:    ${((after.have / after.total) * 100).toFixed(2)}% (${after.have.toLocaleString()}/${after.total.toLocaleString()})`);
  console.log(`Delta:             +${(after.have - before.have).toLocaleString()} listens (+${(((after.have - before.have) / before.total) * 100).toFixed(2)}pp)`);
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
