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
