// Subtle colored dot marking which service/player a listen came from.
// Hover shows the source name (title tooltip — desktop only by nature).
// Known sources get a curated hue; unknown ones fall back to a stable
// hashed palette color so they degrade gracefully instead of vanishing.
// Spotify deliberately is NOT the app's primary green (#22c55e) so the
// dot doesn't read as a UI accent.
const COLORS: Record<string, string> = {
  spotify: "#84cc16",
  navidrome: "#38bdf8",
  "apple music": "#fa2d48",
  "youtube music": "#ff4e45",
  tidal: "#06b6d4",
  deezer: "#a238ff",
  jellyfin: "#aa5cc3",
  plex: "#e5a00d",
  soundcloud: "#ff5500",
  funkwhale: "#009fe3",
  bandcamp: "#1da0c3",
  "last.fm": "#d51007",
};

const FALLBACK = ["#f472b6", "#fb923c", "#a78bfa", "#34d399", "#facc15", "#60a5fa"];

function colorFor(source: string): string {
  const known = COLORS[source];
  if (known) return known;
  let h = 0;
  for (let i = 0; i < source.length; i++) h = (h * 31 + source.charCodeAt(i)) >>> 0;
  return FALLBACK[h % FALLBACK.length];
}

function labelFor(source: string): string {
  return source.replace(/(^|\s)\S/g, (c) => c.toUpperCase());
}

export function SourceDot({ source }: { source?: string | null }) {
  if (!source) return null;
  return (
    <span
      title={labelFor(source)}
      aria-label={`Played on ${labelFor(source)}`}
      className="inline-block w-1.5 h-1.5 rounded-full shrink-0 self-center"
      style={{ backgroundColor: colorFor(source) }}
    />
  );
}
