// Minimal MusicBrainz read client. Used to enrich release metadata (track count,
// release group). Rate-limit aware (~1 req/sec; we keep WELL under by caching
// every result in our releases table on first lookup).

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { withRetry } from "@/lib/db/retry";

const MB_BASE = "https://musicbrainz.org/ws/2";
const UA = "pulse-lb/0.1 (https://github.com/tordar/pulse-lb)";

export type ReleaseMeta = {
  mbid: string;
  releaseGroupMbid: string | null;
  name: string | null;
  trackCount: number | null;
};

export function yearOf(firstReleaseDate: string | null): number | null {
  const y = firstReleaseDate ? parseInt(firstReleaseDate.slice(0, 4), 10) : NaN;
  return Number.isFinite(y) && y > 0 ? y : null;
}

// MB's search API takes batched Lucene queries — rgid:(a OR b OR …) — and
// returns up to 100 entities per request, which makes bulk lookups ~100×
// faster than the entity endpoints. Caller paces requests (~1/s).
async function mbSearch<T>(entity: string, idField: string, mbids: string[]): Promise<T[]> {
  if (mbids.length === 0) return [];
  if (mbids.length > 100) throw new Error("mbSearch: max 100 mbids per batch");
  const query = `${idField}:(${mbids.join(" OR ")})`;
  const url = `${MB_BASE}/${entity}/?query=${encodeURIComponent(query)}&fmt=json&limit=100`;
  const r = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) throw new Error(`MB search ${entity}: ${r.status}`);
  const j = (await r.json()) as Record<string, unknown>;
  return (j[`${entity}s`] as T[]) ?? [];
}

export type ReleaseGroupDate = { mbid: string; name: string | null; firstReleaseDate: string | null };

/** Batch-fetch first-release-dates for up to 100 release groups. */
export async function searchReleaseGroupDates(mbids: string[]): Promise<ReleaseGroupDate[]> {
  const rows = await mbSearch<{ id: string; title?: string; "first-release-date"?: string }>(
    "release-group",
    "rgid",
    mbids,
  );
  return rows.map((rg) => ({
    mbid: rg.id,
    name: rg.title ?? null,
    firstReleaseDate: rg["first-release-date"] || null,
  }));
}

export type ReleaseRG = { mbid: string; name: string | null; releaseGroupMbid: string | null };

/** Batch-resolve up to 100 releases to their release groups. */
export async function searchReleaseRGs(mbids: string[]): Promise<ReleaseRG[]> {
  const rows = await mbSearch<{ id: string; title?: string; "release-group"?: { id?: string } }>(
    "release",
    "reid",
    mbids,
  );
  return rows.map((r) => ({
    mbid: r.id,
    name: r.title ?? null,
    releaseGroupMbid: r["release-group"]?.id ?? null,
  }));
}

export type RecordingLength = { mbid: string; name: string | null; lengthMs: number | null };

/** Batch-fetch lengths for up to 100 recordings. */
export async function searchRecordingLengths(mbids: string[]): Promise<RecordingLength[]> {
  const rows = await mbSearch<{ id: string; title?: string; length?: number }>(
    "recording",
    "rid",
    mbids,
  );
  return rows.map((r) => ({
    mbid: r.id,
    name: r.title ?? null,
    lengthMs: typeof r.length === "number" && r.length > 0 ? r.length : null,
  }));
}

export async function getReleaseMeta(releaseMbid: string): Promise<ReleaseMeta | null> {
  const cached = await withRetry(() =>
    db.query.releases.findFirst({ where: eq(schema.releases.mbid, releaseMbid) }),
  );
  if (cached && cached.trackCount != null) {
    return {
      mbid: cached.mbid,
      releaseGroupMbid: cached.releaseGroupMbid ?? null,
      name: cached.name,
      trackCount: cached.trackCount,
    };
  }

  const url = `${MB_BASE}/release/${releaseMbid}?inc=release-groups+media&fmt=json`;
  const r = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!r || !r.ok) return null;

  const j = (await r.json()) as {
    title?: string;
    "release-group"?: { id?: string; title?: string; "first-release-date"?: string };
    media?: { "track-count"?: number }[];
  };

  // Opportunistic: the release-group sub-object already carries the first
  // release date, so cache it while we're here. Non-fatal — the caller only
  // needs the track count.
  const rg = j["release-group"];
  if (rg?.id) {
    const frd = rg["first-release-date"] || null;
    await withRetry(() =>
      db
        .insert(schema.releaseGroups)
        .values({
          mbid: rg.id!,
          name: rg.title ?? null,
          firstReleaseDate: frd,
          firstReleaseYear: yearOf(frd),
        })
        .onConflictDoUpdate({
          target: schema.releaseGroups.mbid,
          set: { name: rg.title ?? null, firstReleaseDate: frd, firstReleaseYear: yearOf(frd) },
        }),
    ).catch(() => {});
  }

  const trackCount = j.media?.reduce((s, m) => s + (m["track-count"] ?? 0), 0) ?? null;
  const meta: ReleaseMeta = {
    mbid: releaseMbid,
    releaseGroupMbid: j["release-group"]?.id ?? null,
    name: j.title ?? null,
    trackCount: trackCount && trackCount > 0 ? trackCount : null,
  };

  await withRetry(() =>
    db
      .insert(schema.releases)
      .values({
        mbid: meta.mbid,
        releaseGroupMbid: meta.releaseGroupMbid,
        name: meta.name,
        trackCount: meta.trackCount,
      })
      .onConflictDoUpdate({
        target: schema.releases.mbid,
        set: {
          releaseGroupMbid: meta.releaseGroupMbid,
          name: meta.name,
          trackCount: meta.trackCount,
        },
      }),
  );

  return meta;
}
