import { matchArtist, type ArtistIndex } from "./match";

export type RawConcert = {
  date: string;
  artist: string;
  venue?: string | null;
  city?: string | null;
  country?: string | null;
  lat?: number | null;
  lng?: number | null;
  confidence?: string | null;
  notes?: string | null;
  sources?: Array<{ extractor?: string; setlist_url?: string | null }>;
};

export type ConcertInsert = {
  userName: string;
  eventDate: string;
  artistName: string;
  artistMbid: string | null;
  venue: string | null;
  city: string | null;
  country: string | null;
  lat: number | null;
  lng: number | null;
  notes: string | null;
  setlistUrl: string | null;
  confidence: string | null;
};

const blank = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);

export function toConcertRow(username: string, raw: RawConcert, index: ArtistIndex): ConcertInsert {
  const artistName = raw.artist.trim();
  return {
    userName: username,
    eventDate: raw.date,
    artistName,
    artistMbid: matchArtist(index, artistName)?.mbid ?? null,
    venue: blank(raw.venue),
    city: blank(raw.city),
    country: blank(raw.country),
    lat: raw.lat ?? null,
    lng: raw.lng ?? null,
    notes: blank(raw.notes),
    setlistUrl: raw.sources?.find((s) => s.setlist_url)?.setlist_url ?? null,
    confidence: blank(raw.confidence),
  };
}
