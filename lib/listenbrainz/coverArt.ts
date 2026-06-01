export type CoverArtRef = {
  caaId: number | null;
  caaReleaseMbid: string | null;
};

export function coverArtUrl(ref: CoverArtRef, size: 250 | 500 | 1200 = 250): string | null {
  if (!ref.caaId || !ref.caaReleaseMbid) return null;
  return `https://archive.org/download/mbid-${ref.caaReleaseMbid}/mbid-${ref.caaReleaseMbid}-${ref.caaId}_thumb${size}.jpg`;
}
