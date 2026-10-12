export function fmtHours(h: number): string {
  if (!isFinite(h) || h <= 0) return "—";
  if (h < 100) {
    // Round to whole minutes FIRST, then split into h/m. Deciding the unit or
    // splitting off the hours before rounding lets the remainder round up to a
    // full 60 and print nonsense — "1h 60m" for 1.9997h, "60m" for 0.9999h.
    const totalMin = Math.round(h * 60);
    const hr = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (hr === 0) return `${m}m`;
    return m ? `${hr}h ${m}m` : `${hr}h`;
  }
  return `${Math.round(h).toLocaleString()}h`;
}

export function fmtListeningTime(ms: number): string {
  return fmtHours(ms / 1000 / 3600);
}

export function splitDateTime(s: string): { date: string; time: string } {
  const iso = new Date(s).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

/** Song page link for a listen, or null when it has no MusicBrainz recording. */
export function songHref(
  username: string,
  l: { recording_mbid?: string | null; track_name: string; artist_name: string },
): string | null {
  if (!l.recording_mbid) return null;
  const qs = new URLSearchParams({ name: l.track_name, artist: l.artist_name });
  return `/u/${encodeURIComponent(username)}/songs/${l.recording_mbid}?${qs}`;
}
