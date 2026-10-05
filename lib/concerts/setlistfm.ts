export type SetlistInfo = {
  artistName: string;
  eventDate: string;
  venue: string;
  city: string | null;
  country: string | null;
  eventName: string | null;
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];

export function isSetlistUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && /^(www\.)?setlist\.fm$/.test(u.hostname) && u.pathname.startsWith("/setlist/");
  } catch {
    return false;
  }
}

function decode(s: string): string {
  return s
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function meta(html: string, attr: "name" | "property", key: string): string | null {
  const m = html.match(new RegExp(`<meta ${attr}="${key}" content="([^"]*)"`));
  return m ? decode(m[1]) : null;
}

// setlist.fm has no structured data on the page, but every setlist's meta
// description follows one template: "Get the <artist> Setlist of the concert
// at <venue>, <city>[, <state>], <country> on <Month D, YYYY> …".
export function parseSetlistPage(html: string): SetlistInfo | null {
  const desc = meta(html, "name", "description");
  const m = desc?.match(/^Get the (.+?) Setlist of the concert at (.+?) on ([A-Z][a-z]+) (\d{1,2}), (\d{4})/);
  if (!m) return null;
  const [, artistName, place, monthName, day, year] = m;
  const month = MONTHS.indexOf(monthName) + 1;
  if (month === 0) return null;

  const parts = place.split(", ");
  const venue = parts[0];
  const country = parts.length > 1 ? parts[parts.length - 1] : null;
  const city = parts.length > 2 ? parts[1] : null;

  // og:title is "<artist> Setlist at <event>"; for a plain club show the event
  // is just "<venue>, <city>", for a festival it's the festival's name.
  const event = meta(html, "property", "og:title")?.match(/ Setlist at (.+)$/)?.[1] ?? null;
  const eventName = event && !event.startsWith(venue) ? event : null;

  return {
    artistName,
    eventDate: `${year}-${String(month).padStart(2, "0")}-${day.padStart(2, "0")}`,
    venue,
    city,
    country,
    eventName,
  };
}

export type SetlistResult = { ok: true; value: SetlistInfo & { setlistUrl: string } } | { ok: false; error: string };

export async function fetchSetlistInfo(url: string): Promise<SetlistResult> {
  const clean = url.trim();
  if (!isSetlistUrl(clean)) return { ok: false, error: "Paste a setlist.fm setlist link." };
  try {
    const res = await fetch(clean, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; pulse-lb)" },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    const html = await res.text();
    const info = res.ok ? parseSetlistPage(html) : null;
    if (!info) {
      console.warn("setlist.fm parse failed", { url: clean, status: res.status, bytes: html.length,
        title: html.match(/<title>([^<]*)/)?.[1] });
      return { ok: false, error: `Couldn't read that page (status ${res.status}). Add it by hand instead.` };
    }
    return { ok: true, value: { ...info, setlistUrl: clean } };
  } catch (e) {
    console.warn("setlist.fm fetch failed", { url: clean, error: String(e) });
    return { ok: false, error: "Couldn't reach setlist.fm. Add it by hand instead." };
  }
}
