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

export function setlistIdFromUrl(url: string): string | null {
  return url.match(/-([0-9a-f]+)\.html$/)?.[1] ?? null;
}

type ApiSetlist = {
  eventDate?: string;
  artist?: { name?: string };
  venue?: { name?: string; city?: { name?: string; country?: { name?: string } } };
};

export function parseSetlistApi(s: ApiSetlist): SetlistInfo | null {
  const d = s.eventDate?.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!d || !s.artist?.name || !s.venue?.name) return null;
  return {
    artistName: s.artist.name,
    eventDate: `${d[3]}-${d[2]}-${d[1]}`,
    venue: s.venue.name,
    city: s.venue.city?.name ?? null,
    country: s.venue.city?.country?.name ?? null,
    eventName: null,
  };
}

// setlist.fm answers datacenter IPs (Vercel) with a 202 bot-check page, so the
// page can't be scraped from prod. The official API isn't behind that check;
// scraping stays as the fallback for deployments without a key.
async function fromApi(id: string, key: string): Promise<SetlistInfo | null> {
  const res = await fetch(`https://api.setlist.fm/rest/1.0/setlist/${id}`, {
    headers: { "x-api-key": key, Accept: "application/json" },
    signal: AbortSignal.timeout(8000),
    cache: "no-store",
  });
  if (!res.ok) {
    console.warn("setlist.fm API failed", { id, status: res.status });
    return null;
  }
  return parseSetlistApi(await res.json());
}

async function fromPage(url: string): Promise<SetlistInfo | null> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; pulse-lb)" },
    signal: AbortSignal.timeout(8000),
    cache: "no-store",
  });
  const html = await res.text();
  const info = res.ok ? parseSetlistPage(html) : null;
  if (!info) {
    console.warn("setlist.fm page parse failed", { url, status: res.status, bytes: html.length,
      title: html.match(/<title>([^<]*)/)?.[1] });
  }
  return info;
}

export async function fetchSetlistInfo(url: string): Promise<SetlistResult> {
  const clean = url.trim();
  const id = setlistIdFromUrl(clean);
  if (!isSetlistUrl(clean) || !id) return { ok: false, error: "Paste a setlist.fm setlist link." };
  const key = process.env.SETLIST_FM_API_KEY;
  try {
    const info = key ? await fromApi(id, key) : await fromPage(clean);
    if (!info) return { ok: false, error: "Couldn't read that setlist. Add it by hand instead." };
    return { ok: true, value: { ...info, setlistUrl: clean } };
  } catch (e) {
    console.warn("setlist.fm fetch failed", { url: clean, error: String(e) });
    return { ok: false, error: "Couldn't reach setlist.fm. Add it by hand instead." };
  }
}
