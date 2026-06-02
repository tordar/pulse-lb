import { inArray, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { withRetry } from "@/lib/db/retry";
import { lbFetch } from "./client";

const BATCH = 25;

/**
 * Look up MB recording lengths for the given MBIDs.
 * Returns a Map<mbid, lengthMs> populated from our cache plus a one-shot fetch
 * for anything missing. Results are written back to the recordings table so
 * the next user benefits.
 */
export async function ensureRecordingLengths(
  recordingMbids: (string | null | undefined)[],
): Promise<Map<string, number>> {
  const ids = [...new Set(recordingMbids.filter((x): x is string => !!x))];
  if (ids.length === 0) return new Map();

  const cached = await withRetry(() =>
    db.query.recordings.findMany({ where: inArray(schema.recordings.mbid, ids) }),
  );
  const lengths = new Map<string, number>();
  for (const row of cached) {
    if (row.lengthMs != null) lengths.set(row.mbid, row.lengthMs);
  }

  const missing = ids.filter((id) => !cached.some((r) => r.mbid === id));
  if (missing.length === 0) return lengths;

  const inserts: { mbid: string; name: string | null; lengthMs: number | null }[] = [];
  for (let i = 0; i < missing.length; i += BATCH) {
    const batch = missing.slice(i, i + BATCH);
    let data: Record<string, { recording?: { name?: string | null; length?: number | null } }> = {};
    try {
      const r = await lbFetch(`/1/metadata/recording?recording_mbids=${batch.join(",")}`, {
        timeoutMs: 15_000,
      });
      data = (await r.json().catch(() => ({}))) as typeof data;
    } catch {
      continue;
    }
    for (const mbid of batch) {
      const meta = data[mbid]?.recording;
      const len = meta?.length ?? null;
      inserts.push({ mbid, name: meta?.name ?? null, lengthMs: len });
      if (len != null) lengths.set(mbid, len);
    }
  }

  if (inserts.length > 0) {
    // Bulk upsert. Postgres conflict-do-update with ARRAY-of-values input.
    await withRetry(() =>
      db.execute(sql`
        INSERT INTO recordings (mbid, name, length_ms)
        SELECT * FROM UNNEST(
          ${sql`ARRAY[${sql.join(inserts.map((r) => sql`${r.mbid}::uuid`), sql`, `)}]`}::uuid[],
          ${sql`ARRAY[${sql.join(inserts.map((r) => sql`${r.name}::text`), sql`, `)}]`}::text[],
          ${sql`ARRAY[${sql.join(inserts.map((r) => sql`${r.lengthMs}::int`), sql`, `)}]`}::int[]
        )
        ON CONFLICT (mbid) DO UPDATE
          SET name = EXCLUDED.name,
              length_ms = COALESCE(EXCLUDED.length_ms, recordings.length_ms)
      `),
    );
  }

  return lengths;
}
