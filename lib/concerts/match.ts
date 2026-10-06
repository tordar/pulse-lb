export type LibraryArtist = { artistName: string; mbid: string; plays: number };
export type ArtistIndex = Map<string, LibraryArtist>;

export function normalizeArtist(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[\u2018\u2019\u02bc`]/g, "'")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^the /, "");
}

export function buildArtistIndex(lib: LibraryArtist[]): ArtistIndex {
  const idx: ArtistIndex = new Map();
  for (const a of lib) {
    const key = normalizeArtist(a.artistName);
    const cur = idx.get(key);
    if (!cur || a.plays > cur.plays) idx.set(key, a);
  }
  return idx;
}

// Joint billings ("Neil Young + Promise of the Real", "Sex Pistols feat. Frank
// Carter") link to their lead artist when the full billing isn't in the library.
const BILLING_SPLIT = /\s+(?:\+|&|and|og|with|feat\.?|ft\.?|featuring|x)\s+/i;

export function matchArtist(index: ArtistIndex, name: string): LibraryArtist | null {
  const exact = index.get(normalizeArtist(name));
  if (exact) return exact;
  const lead = name.split(BILLING_SPLIT)[0];
  return lead !== name ? index.get(normalizeArtist(lead)) ?? null : null;
}
