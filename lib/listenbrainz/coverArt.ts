export type CoverArtRef = {
  caaId: number | null;
  caaReleaseMbid: string | null;
};

export const COVER_SIZES = [250, 500, 1200] as const;
export type CoverSize = (typeof COVER_SIZES)[number];

/**
 * The archive.org thumbnail itself. Only /api/cover should fetch this — see
 * coverArtSrc for why nothing in the browser points here.
 */
export function coverArtUrl(ref: CoverArtRef, size: CoverSize = 250): string | null {
  if (!ref.caaId || !ref.caaReleaseMbid) return null;
  return `https://archive.org/download/mbid-${ref.caaReleaseMbid}/mbid-${ref.caaReleaseMbid}-${ref.caaId}_thumb${size}.jpg`;
}

/**
 * Same-origin cover URL, served by app/api/cover. Keeps what routing through
 * next/image bought us — one origin fetch per cover, CDN-cached, the browser
 * never talking to archive.org — without spending a metered image
 * transformation on a thumbnail archive.org already sized for us.
 */
export function coverArtSrc(ref: CoverArtRef, size: CoverSize = 250): string | null {
  if (!ref.caaId || !ref.caaReleaseMbid) return null;
  return `/api/cover/${ref.caaReleaseMbid}/${ref.caaId}?s=${size}`;
}

type CaaListing = { release?: string; images?: { id: number | string; front?: boolean }[] };

/**
 * Front cover for a release from the Cover Art Archive, falling back to its
 * release group (CAA then picks a release in the group and says which).
 * Null when neither has art or CAA doesn't answer.
 */
export async function fetchCaaCover(
  releaseMbid: string,
  releaseGroupMbid: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<CoverArtRef | null> {
  const paths = [`release/${releaseMbid}`, ...(releaseGroupMbid ? [`release-group/${releaseGroupMbid}`] : [])];
  for (const path of paths) {
    const r = await fetchImpl(`https://coverartarchive.org/${path}`, {
      signal: AbortSignal.timeout(5_000),
    }).catch(() => null);
    if (!r?.ok) continue;
    const j = (await r.json().catch(() => null)) as CaaListing | null;
    const front = j?.images?.find((i) => i.front);
    const release = j?.release?.split("/").pop() ?? releaseMbid;
    if (front) return { caaId: Number(front.id), caaReleaseMbid: release };
  }
  return null;
}
