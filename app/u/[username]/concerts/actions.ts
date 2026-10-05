"use server";

import { updateTag } from "next/cache";
import { and, eq, gt, lt, or, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { requireOwner } from "@/lib/concerts/owner";
import { isUuid, parseConcertForm, parseFestivalForm, dateInRange } from "@/lib/concerts/form";
import { loadArtistIndex } from "@/lib/concerts/library";
import { matchArtist } from "@/lib/concerts/match";
import { searchAll } from "@/lib/db/queries/topItems";
import { fetchSetlistInfo, searchSetlists, type SearchResult, type SetlistResult } from "@/lib/concerts/setlistfm";

export type FormState = {
  error: string | null;
  savedAt: number | null;
  values?: Record<string, string>;
  nonce?: number;
};

const fail = (error: string, fd: FormData): FormState => ({
  error,
  savedAt: null,
  values: Object.fromEntries([...fd.entries()].filter((e): e is [string, string] => typeof e[1] === "string")),
  nonce: Date.now(),
});

const done = (username: string): FormState => {
  updateTag(`user:${username}`);
  return { error: null, savedAt: Date.now() };
};

const isUniqueViolation = (e: unknown) =>
  (e as { code?: string })?.code === "23505" || (e as { cause?: { code?: string } })?.cause?.code === "23505";

export async function saveConcert(username: string, _prev: FormState, fd: FormData): Promise<FormState> {
  await requireOwner(username);
  const parsed = parseConcertForm(fd);
  if (!parsed.ok) return fail(parsed.error, fd);
  const v = parsed.value;

  if (v.festivalId) {
    const [f] = await db.select().from(schema.festivals)
      .where(and(eq(schema.festivals.id, v.festivalId), eq(schema.festivals.userName, username)));
    if (!f) return fail("Festival not found.", fd);
    if (!dateInRange(v.eventDate, f.startDate, f.endDate))
      return fail(`Date must be within ${f.name} (${f.startDate} – ${f.endDate}).`, fd);
  }

  const artistMbid = matchArtist(await loadArtistIndex(username), v.artistName)?.mbid ?? null;
  const values = {
    eventDate: v.eventDate, artistName: v.artistName, artistMbid, festivalId: v.festivalId,
    venue: v.venue, city: v.city, country: v.country, notes: v.notes, setlistUrl: v.setlistUrl,
  };

  try {
    if (v.id) {
      const updated = await db.update(schema.concerts)
        .set({ ...values, updatedAt: sql`now()` })
        .where(and(eq(schema.concerts.id, v.id), eq(schema.concerts.userName, username)))
        .returning({ id: schema.concerts.id });
      if (updated.length === 0) return fail("Concert not found.", fd);
    } else {
      await db.insert(schema.concerts).values({ ...values, userName: username });
    }
  } catch (e) {
    if (isUniqueViolation(e))
      return fail("You already have this artist on this date at this venue.", fd);
    throw e;
  }
  return done(username);
}

export async function saveFestival(username: string, _prev: FormState, fd: FormData): Promise<FormState> {
  await requireOwner(username);
  const parsed = parseFestivalForm(fd);
  if (!parsed.ok) return fail(parsed.error, fd);
  const { id, ...v } = parsed.value;

  if (id) {
    const outside = await db.select({ id: schema.concerts.id }).from(schema.concerts)
      .where(and(
        eq(schema.concerts.festivalId, id),
        eq(schema.concerts.userName, username),
        or(lt(schema.concerts.eventDate, v.startDate), gt(schema.concerts.eventDate, v.endDate)),
      ))
      .limit(1);
    if (outside.length > 0)
      return fail("Some sets fall outside these dates. Move or remove them first.", fd);
    const updated = await db.update(schema.festivals)
      .set({ ...v, updatedAt: sql`now()` })
      .where(and(eq(schema.festivals.id, id), eq(schema.festivals.userName, username)))
      .returning({ id: schema.festivals.id });
    if (updated.length === 0) return fail("Festival not found.", fd);
  } else {
    await db.insert(schema.festivals).values({ ...v, userName: username });
  }
  return done(username);
}

export async function deleteConcert(username: string, id: string): Promise<void> {
  await requireOwner(username);
  if (!isUuid(id)) return;
  await db.delete(schema.concerts)
    .where(and(eq(schema.concerts.id, id), eq(schema.concerts.userName, username)));
  done(username);
}

export async function deleteFestival(username: string, id: string): Promise<void> {
  await requireOwner(username);
  if (!isUuid(id)) return;
  // FK is ON DELETE SET NULL: the festival's concerts become standalone.
  await db.delete(schema.festivals)
    .where(and(eq(schema.festivals.id, id), eq(schema.festivals.userName, username)));
  done(username);
}

export async function searchLibraryArtists(username: string, q: string): Promise<string[]> {
  await requireOwner(username);
  if (q.trim().length < 2) return [];
  return (await searchAll(username, q)).artists.map((a) => a.artist_name);
}

export async function fetchSetlist(username: string, url: string): Promise<SetlistResult> {
  await requireOwner(username);
  return fetchSetlistInfo(url);
}

export async function searchSetlistFm(username: string, artist: string, year: string, page: number): Promise<SearchResult> {
  await requireOwner(username);
  if (artist.trim().length < 2) return { ok: false, error: "Type at least 2 letters of the artist." };
  return searchSetlists(artist, year, Math.max(1, Math.floor(page)));
}
