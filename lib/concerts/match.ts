export type LibraryArtist = { artistName: string; mbid: string; plays: number };
export type ArtistIndex = Map<string, LibraryArtist>;

export function normalizeArtist(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
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

export function matchArtist(index: ArtistIndex, name: string): LibraryArtist | null {
  return index.get(normalizeArtist(name)) ?? null;
}
