// Bucket keys shared by the server-rendered top lists and the client-side
// projection of listens the live poller has seen. Deliberately NOT in liveDelta.ts: that module
// is "use client", so anything exported from it becomes a client reference and
// throws if a server component calls it.

// Mirrors agg_song.group_key in lib/db/aggregates/rebuild.ts.
export function songKey(
  recordingMbid: string | null,
  trackName: string,
  artistName: string,
): string {
  return `${recordingMbid ?? `~${trackName}`}|${artistName ?? ""}`;
}

// agg_artist groups on artist_name verbatim.
export function artistKey(artistName: string): string {
  return artistName ?? "";
}

// Approximate: agg_album groups on album CLUSTERS (reissues and case variants
// merged — see albumCluster.ts), which can't be reproduced client-side. Casefold
// is the cheap half of it and covers the common variant.
export function albumKey(releaseName: string | null, artistName: string): string {
  return `${(releaseName ?? "").toLowerCase()}|${(artistName ?? "").toLowerCase()}`;
}
