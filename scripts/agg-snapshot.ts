import "dotenv/config";
import postgres from "postgres";
import { writeFileSync } from "node:fs";

const TABLES = ["agg_alltime", "agg_year", "agg_hour", "agg_day", "agg_song", "agg_artist", "agg_album"];

export async function snapshot(sql: postgres.Sql, user: string): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for (const t of TABLES) {
    const rows = await sql.unsafe(`SELECT * FROM ${t} WHERE user_name = $1`, [user]);
    out[t] = rows
      .map((r: Record<string, unknown>) => {
        const { computed_at: _, ...rest } = r;
        if (Array.isArray(rest.member_artists)) rest.member_artists = [...rest.member_artists].sort();
        return JSON.stringify(rest, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
      })
      .sort();
  }
  return out;
}

export function diff(a: Record<string, string[]>, b: Record<string, string[]>): string[] {
  const problems: string[] = [];
  for (const t of TABLES) {
    const sa = new Set(a[t]); const sb = new Set(b[t]);
    const onlyA = a[t].filter((x) => !sb.has(x)); const onlyB = b[t].filter((x) => !sa.has(x));
    if (onlyA.length || onlyB.length || a[t].length !== b[t].length) {
      problems.push(`${t}: ${onlyA.length} only-left, ${onlyB.length} only-right, rows ${a[t].length} vs ${b[t].length}`);
      onlyA.slice(0, 3).forEach((x) => problems.push(`  - ${x}`));
      onlyB.slice(0, 3).forEach((x) => problems.push(`  + ${x}`));
    }
  }
  return problems;
}

if (process.argv[1]?.endsWith("agg-snapshot.ts")) {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  snapshot(sql, process.argv[2]).then((s) => {
    const json = JSON.stringify(s);
    if (process.argv[3]) writeFileSync(process.argv[3], json); else console.log(json);
    return sql.end();
  });
}
