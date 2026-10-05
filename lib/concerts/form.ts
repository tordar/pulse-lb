export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export type ConcertInput = {
  id: string | null; eventDate: string; artistName: string; venue: string | null;
  city: string | null; country: string | null; notes: string | null;
  setlistUrl: string | null; festivalId: string | null;
};

export type FestivalInput = {
  id: string | null; name: string; startDate: string; endDate: string;
  venue: string | null; city: string | null; country: string | null; notes: string | null;
};

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() ? v.trim() : null;
};

export function isIsoDate(d: string | null): d is string {
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  return new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;
}

export const isUuid = (v: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export const dateInRange = (d: string, start: string, end: string) => d >= start && d <= end;

export function parseConcertForm(fd: FormData): Parsed<ConcertInput> {
  const eventDate = str(fd, "eventDate");
  const artistName = str(fd, "artistName");
  const setlistUrl = str(fd, "setlistUrl");
  const id = str(fd, "id");
  const festivalId = str(fd, "festivalId");
  if ((id && !isUuid(id)) || (festivalId && !isUuid(festivalId))) return { ok: false, error: "Not found." };
  if (!artistName) return { ok: false, error: "Artist is required." };
  if (!isIsoDate(eventDate)) return { ok: false, error: "Enter a valid date." };
  if (setlistUrl && !/^https?:\/\//i.test(setlistUrl))
    return { ok: false, error: "Setlist link must start with http:// or https://." };
  return {
    ok: true,
    value: {
      id, eventDate, artistName, venue: str(fd, "venue"), city: str(fd, "city"),
      country: str(fd, "country"), notes: str(fd, "notes"), setlistUrl, festivalId,
    },
  };
}

export function parseFestivalForm(fd: FormData): Parsed<FestivalInput> {
  const name = str(fd, "name");
  const startDate = str(fd, "startDate");
  const endDate = str(fd, "endDate");
  const id = str(fd, "id");
  if (id && !isUuid(id)) return { ok: false, error: "Not found." };
  if (!name) return { ok: false, error: "Name is required." };
  if (!isIsoDate(startDate) || !isIsoDate(endDate)) return { ok: false, error: "Enter valid dates." };
  if (endDate < startDate) return { ok: false, error: "End date is before start date." };
  return {
    ok: true,
    value: {
      id, name, startDate, endDate, venue: str(fd, "venue"), city: str(fd, "city"),
      country: str(fd, "country"), notes: str(fd, "notes"),
    },
  };
}
