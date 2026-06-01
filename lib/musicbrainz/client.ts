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
    "release-group"?: { id?: string };
    media?: { "track-count"?: number }[];
  };

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
