/**
 * Deep backfill for release_group_mbid.
 *
 * `/1/stats/user/{name}/release-groups` caps at the top 1000 albums. For the
 * long tail we use `/1/metadata/recording?inc=release` which returns the
 * release.release_group_mbid for every recording_mbid we hand it, in batches.
 *
 * Coverage ceiling: whatever fraction of our listens has a recording_mbid
 * (~96% in practice).
 */
import "dotenv/config";
import postgres from "postgres";

const USER = process.argv[2] ?? "tordar";
const BATCH = 25;
const LB = "https://api.listenbrainz.org";

type MetaResponse = Record<
  string,
  {
    recording?: { length?: number | null; name?: string | null };
    release?: { mbid?: string; release_group_mbid?: string };
  }
>;

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });

  const [before] = await sql`
    SELECT
      COUNT(*) FILTER (WHERE release_group_mbid IS NOT NULL)::int AS have,
      COUNT(*)::int AS total
    FROM listens WHERE user_name = ${USER}
  `;
  console.log(
    `Before: ${before.have.toLocaleString()}/${before.total.toLocaleString()} listens have rgid (${((before.have / before.total) * 100).toFixed(2)}%)`,
  );

  // Distinct recording_mbids on listens that don't yet have release_group_mbid.
  const distinctRows = await sql`
    SELECT DISTINCT recording_mbid::text AS rid
    FROM listens
    WHERE user_name = ${USER}
      AND recording_mbid IS NOT NULL
      AND release_group_mbid IS NULL
  `;
  const recIds: string[] = distinctRows.map((r) => r.rid).filter(Boolean);
  console.log(`Distinct recording_mbids to look up: ${recIds.length.toLocaleString()}`);

  const t0 = Date.now();
  let apiCalls = 0;
  let resolved = 0;
  let totalUpdated = 0;

  // Accumulate (recording_mbid → release_group_mbid) into pending batches
  // to UPSERT into listens in large UPDATE FROM UNNEST queries.
  const pending: { rid: string; rgid: string }[] = [];

  async function flush() {
    if (pending.length === 0) return;
    const rids = pending.map((p) => p.rid);
    const rgids = pending.map((p) => p.rgid);
    const result = await sql`
      WITH src AS (
        SELECT * FROM UNNEST(${rids}::uuid[], ${rgids}::uuid[]) AS t(rid, rgid)
      )
      UPDATE listens l
      SET release_group_mbid = src.rgid
      FROM src
      WHERE l.user_name = ${USER}
        AND l.recording_mbid = src.rid
        AND l.release_group_mbid IS NULL
      RETURNING 1
    `;
    totalUpdated += result.length;
    pending.length = 0;
  }

  for (let i = 0; i < recIds.length; i += BATCH) {
    const batch = recIds.slice(i, i + BATCH);
    apiCalls++;
    const url = `${LB}/1/metadata/recording?recording_mbids=${batch.join(",")}&inc=release`;

    let data: MetaResponse | null = null;
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(20_000) });
        if (r.status === 429) {
          const reset = Number(r.headers.get("x-ratelimit-reset-in") ?? 5);
          await new Promise((res) => setTimeout(res, (reset + 1) * 1000));
          continue;
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        data = (await r.json()) as MetaResponse;
        break;
      } catch {
        if (attempt === 4) break;
        await new Promise((res) => setTimeout(res, attempt * 1000));
      }
    }

    if (data) {
      for (const rid of batch) {
        const rgid = data[rid]?.release?.release_group_mbid;
        if (rgid) {
          pending.push({ rid, rgid });
          resolved++;
        }
      }
    }

    if (pending.length >= 500) await flush();

    if (apiCalls % 25 === 0) {
      const eta = (((Date.now() - t0) / apiCalls) * ((recIds.length / BATCH) - apiCalls)) / 1000;
      console.log(
        `  ${apiCalls} calls, ${resolved.toLocaleString()} recording→rgid resolved, ${totalUpdated.toLocaleString()} listens updated, eta ~${Math.round(eta)}s`,
      );
    }
  }

  await flush();

  const [after] = await sql`
    SELECT
      COUNT(*) FILTER (WHERE release_group_mbid IS NOT NULL)::int AS have,
      COUNT(*)::int AS total
    FROM listens WHERE user_name = ${USER}
  `;

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log();
  console.log("=== Deep backfill summary ===");
  console.log(`Wall-clock:              ${elapsed}s`);
  console.log(`LB API calls:            ${apiCalls.toLocaleString()}`);
  console.log(`Recordings resolved:     ${resolved.toLocaleString()} / ${recIds.length.toLocaleString()}`);
  console.log(`Listens updated:         ${totalUpdated.toLocaleString()}`);
  console.log(`Coverage before:         ${((before.have / before.total) * 100).toFixed(2)}% (${before.have.toLocaleString()}/${before.total.toLocaleString()})`);
  console.log(`Coverage after:          ${((after.have / after.total) * 100).toFixed(2)}% (${after.have.toLocaleString()}/${after.total.toLocaleString()})`);
  console.log(`Delta:                   +${(after.have - before.have).toLocaleString()} listens (+${(((after.have - before.have) / before.total) * 100).toFixed(2)}pp)`);
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
