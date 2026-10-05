import { test } from "node:test";
import assert from "node:assert/strict";
import { buildArtistIndex } from "./match";
import { toConcertRow, type RawConcert } from "./importRow";

const idx = buildArtistIndex([{ artistName: "Oslo Ess", mbid: "mb-oslo", plays: 5 }]);

const base: RawConcert = {
  date: "2011-11-24", artist: "Oslo Ess", venue: "Aud Max", city: "Ås", country: "Norway",
  lat: 59.66, lng: 10.78, confidence: "high", notes: null,
  sources: [
    { extractor: "PHOTO_LABEL_CLUSTER" },
    { extractor: "MANUAL", setlist_url: null },
    { extractor: "SETLISTFM", setlist_url: "https://www.setlist.fm/x" },
  ],
};

test("maps fields and links a known artist", () => {
  const row = toConcertRow("tordar", base, idx);
  assert.deepEqual(row, {
    userName: "tordar", eventDate: "2011-11-24", artistName: "Oslo Ess", artistMbid: "mb-oslo",
    venue: "Aud Max", city: "Ås", country: "Norway", lat: 59.66, lng: 10.78,
    notes: null, setlistUrl: "https://www.setlist.fm/x", confidence: "high",
  });
});

test("unknown artist gets a null mbid", () => {
  assert.equal(toConcertRow("tordar", { ...base, artist: "Nobody" }, idx).artistMbid, null);
});

test("empty strings become null and artist is trimmed", () => {
  const row = toConcertRow("tordar", { ...base, artist: " Oslo Ess ", venue: "", city: "  " }, idx);
  assert.equal(row.artistName, "Oslo Ess");
  assert.equal(row.venue, null);
  assert.equal(row.city, null);
});

test("no setlist url anywhere → null", () => {
  assert.equal(toConcertRow("tordar", { ...base, sources: [] }, idx).setlistUrl, null);
});
