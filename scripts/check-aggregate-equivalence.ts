import "dotenv/config";
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

const USERNAME = process.argv[2];
const YEAR = process.argv[3] ? Number(process.argv[3]) : null;
if (!USERNAME) {
  console.error("Usage: tsx scripts/check-aggregate-equivalence.ts <username> [year]");
  process.exit(1);
}
const sampleYear = YEAR ?? new Date().getUTCFullYear();

const checks: Array<{ name: string; old: () => Promise<unknown[]>; nu: () => Promise<unknown[]> }> = [
  {
    name: "allTimeStats",
    old: async () => (await sql`
      SELECT
        COUNT(*)::int AS total_plays,
        COALESCE(SUM(COALESCE(l.duration_ms, r.length_ms)), 0)::bigint AS effective_ms,
        COUNT(DISTINCT l.artist_name)::int AS distinct_artists,
        COUNT(DISTINCT l.release_name)::int AS distinct_albums,
        COUNT(DISTINCT COALESCE(l.recording_mbid::text, l.track_name))::int AS distinct_songs,
        MIN(l.listened_at) AS first_played,
        MAX(l.listened_at) AS last_played,
        ROUND(100.0 * COUNT(*) FILTER (WHERE l.duration_ms IS NOT NULL OR r.length_ms IS NOT NULL) / NULLIF(COUNT(*), 0), 1)::float8 AS duration_coverage_pct
      FROM listens l LEFT JOIN recordings r ON r.mbid = l.recording_mbid
      WHERE l.user_name = ${USERNAME}
    `) as unknown[],
    nu: async () => (await sql`
      SELECT total_plays, effective_ms, distinct_artists, distinct_albums, distinct_songs,
             first_played, last_played, duration_coverage_pct
      FROM agg_alltime WHERE user_name = ${USERNAME}
    `) as unknown[],
  },
  {
    name: "yearlyListening",
    old: async () => (await sql`
      SELECT EXTRACT(YEAR FROM l.listened_at)::int AS year,
             COUNT(*)::int AS plays,
             ROUND(COALESCE(SUM(COALESCE(l.duration_ms, r.length_ms)), 0)/1000.0/3600, 2)::float8 AS hours
      FROM listens l LEFT JOIN recordings r ON r.mbid = l.recording_mbid
      WHERE l.user_name = ${USERNAME}
      GROUP BY year ORDER BY year
    `) as unknown[],
    nu: async () => (await sql`
      SELECT year, plays, hours FROM agg_year WHERE user_name = ${USERNAME} ORDER BY year
    `) as unknown[],
  },
  {
    name: "hourlyDistribution",
    old: async () => (await sql`
      WITH local AS (
        SELECT EXTRACT(HOUR FROM listened_at)::int AS hour
        FROM listens WHERE user_name = ${USERNAME}
      )
      SELECT h.hour, COALESCE(c.plays, 0)::int AS plays
      FROM generate_series(0, 23) AS h(hour)
      LEFT JOIN (SELECT hour, COUNT(*)::int AS plays FROM local GROUP BY hour) c USING (hour)
      ORDER BY h.hour
    `) as unknown[],
    nu: async () => (await sql`
      SELECT hour, plays FROM agg_hour WHERE user_name = ${USERNAME} ORDER BY hour
    `) as unknown[],
  },
  {
    name: "availableYears",
    old: async () => (await sql`
      SELECT DISTINCT EXTRACT(YEAR FROM listened_at)::int AS year
      FROM listens WHERE user_name = ${USERNAME} ORDER BY year DESC
    `) as unknown[],
    nu: async () => (await sql`
      SELECT year FROM agg_year WHERE user_name = ${USERNAME} ORDER BY year DESC
    `) as unknown[],
  },
  {
    name: `topSongsByYear(${sampleYear})`,
    old: async () => (await sql`
      SELECT
        (array_agg(l.track_name ORDER BY l.listened_at DESC))[1] AS track_name,
        l.artist_name,
        COUNT(*)::int AS plays,
        COALESCE(SUM(COALESCE(l.duration_ms, r.length_ms)), 0)::bigint AS effective_ms
      FROM listens l LEFT JOIN recordings r ON r.mbid = l.recording_mbid
      WHERE l.user_name = ${USERNAME} AND EXTRACT(YEAR FROM l.listened_at)::int = ${sampleYear}
      GROUP BY COALESCE(l.recording_mbid::text, '~' || l.track_name), l.artist_name
      ORDER BY plays DESC, track_name
      LIMIT 5
    `) as unknown[],
    nu: async () => (await sql`
      SELECT track_name, artist_name, plays, effective_ms
      FROM agg_song WHERE user_name = ${USERNAME} AND scope = ${sampleYear}
      ORDER BY plays DESC, track_name LIMIT 5
    `) as unknown[],
  },
  {
    name: `topAlbumsByYear(${sampleYear})`,
    old: async () => (await sql`
      SELECT l.release_name, l.artist_name,
        COUNT(*)::int AS plays,
        COALESCE(SUM(COALESCE(l.duration_ms, r.length_ms)), 0)::bigint AS effective_ms
      FROM listens l LEFT JOIN recordings r ON r.mbid = l.recording_mbid
      WHERE l.user_name = ${USERNAME} AND l.release_name IS NOT NULL
        AND EXTRACT(YEAR FROM l.listened_at)::int = ${sampleYear}
      GROUP BY l.release_name, l.artist_name
      ORDER BY plays DESC, l.release_name LIMIT 5
    `) as unknown[],
    nu: async () => (await sql`
      SELECT release_name, artist_name, plays, effective_ms
      FROM agg_album WHERE user_name = ${USERNAME} AND scope = ${sampleYear}
      ORDER BY plays DESC, release_name LIMIT 5
    `) as unknown[],
  },
  {
    name: `topArtistsByYear(${sampleYear})`,
    old: async () => (await sql`
      SELECT l.artist_name,
        COUNT(*)::int AS plays,
        COALESCE(SUM(COALESCE(l.duration_ms, r.length_ms)), 0)::bigint AS effective_ms,
        COUNT(DISTINCT COALESCE(l.recording_mbid::text, l.track_name))::int AS distinct_songs
      FROM listens l LEFT JOIN recordings r ON r.mbid = l.recording_mbid
      WHERE l.user_name = ${USERNAME} AND l.artist_name IS NOT NULL
        AND EXTRACT(YEAR FROM l.listened_at)::int = ${sampleYear}
      GROUP BY l.artist_name
      ORDER BY plays DESC, l.artist_name LIMIT 5
    `) as unknown[],
    nu: async () => (await sql`
      SELECT artist_name, plays, effective_ms, distinct_songs
      FROM agg_artist WHERE user_name = ${USERNAME} AND scope = ${sampleYear}
      ORDER BY plays DESC, artist_name LIMIT 5
    `) as unknown[],
  },
];

function normalize(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(normalize);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as object).sort()) {
      out[k] = normalize((v as Record<string, unknown>)[k]);
    }
    return out;
  }
  if (typeof v === "bigint") return v.toString();
  return v;
}

async function main() {
  let fail = 0;
  for (const c of checks) {
    const [oldR, nuR] = await Promise.all([c.old(), c.nu()]);
    const a = JSON.stringify(normalize(oldR));
    const b = JSON.stringify(normalize(nuR));
    if (a === b) {
      console.log(`PASS  ${c.name}`);
    } else {
      fail++;
      console.log(`FAIL  ${c.name}`);
      console.log(`  old: ${a.slice(0, 400)}`);
      console.log(`  new: ${b.slice(0, 400)}`);
    }
  }
  if (fail > 0) {
    console.error(`\n${fail} check(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll checks passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
