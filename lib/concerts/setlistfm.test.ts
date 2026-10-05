import { test } from "node:test";
import assert from "node:assert/strict";
import { isSetlistUrl, parseSetlistApi, parseSetlistPage, setlistIdFromUrl } from "./setlistfm";

const page = (desc: string, title: string) =>
  `<html><head><meta name="description" content="${desc}"/><meta property="og:title" content="${title}"/></head></html>`;

test("parses artist, date, venue, city, country and festival name", () => {
  const html = page(
    "Get the Tyler, The Creator Setlist of the concert at Tøyenparken, Oslo, Norway on August 13, 2015 from the Cherry Bomb Tour and other Tyler, The Creator Setlists for free on setlist.fm!",
    "Tyler, The Creator Setlist at Øyafestivalen 2015",
  );
  assert.deepEqual(parseSetlistPage(html), {
    artistName: "Tyler, The Creator",
    eventDate: "2015-08-13",
    venue: "Tøyenparken",
    city: "Oslo",
    country: "Norway",
    eventName: "Øyafestivalen 2015",
  });
});

test("US addresses drop the state; plain club shows have no event name", () => {
  const html = page(
    "Get the Title Fight Setlist of the concert at The Fillmore, San Francisco, CA, USA on May 1, 2015 and other Title Fight Setlists for free on setlist.fm!",
    "Title Fight Setlist at The Fillmore, San Francisco",
  );
  const r = parseSetlistPage(html);
  assert.equal(r?.venue, "The Fillmore");
  assert.equal(r?.city, "San Francisco");
  assert.equal(r?.country, "USA");
  assert.equal(r?.eventDate, "2015-05-01");
  assert.equal(r?.eventName, null);
});

test("decodes HTML entities", () => {
  const html = page(
    "Get the Noel Gallagher&#039;s High Flying Birds Setlist of the concert at Spektrum, Oslo, Norway on March 3, 2012 and other setlists",
    "x",
  );
  assert.equal(parseSetlistPage(html)?.artistName, "Noel Gallagher's High Flying Birds");
});

test("returns null for pages that are not a setlist", () => {
  assert.equal(parseSetlistPage("<html><title>Not found</title></html>"), null);
});

test("isSetlistUrl accepts only setlist.fm setlist pages", () => {
  assert.equal(isSetlistUrl("https://www.setlist.fm/setlist/frank-ocean/2017/slottsskogen-gothenburg-sweden-1be515f4.html"), true);
  assert.equal(isSetlistUrl("https://setlist.fm/setlist/a/2017/b-1.html"), true);
  assert.equal(isSetlistUrl("https://evil.example/setlist/a.html"), false);
  assert.equal(isSetlistUrl("https://www.setlist.fm.evil.example/setlist/a.html"), false);
  assert.equal(isSetlistUrl("not a url"), false);
});

test("setlistIdFromUrl takes the hex id before .html", () => {
  assert.equal(setlistIdFromUrl("https://www.setlist.fm/setlist/raga-rockers/2015/arena-lillomarka-grorud-norway-7bf5823c.html"), "7bf5823c");
  assert.equal(setlistIdFromUrl("https://www.setlist.fm/setlist/a/2015/b.html"), null);
});

test("parseSetlistApi maps the API response", () => {
  assert.deepEqual(
    parseSetlistApi({
      eventDate: "12-09-2015",
      artist: { name: "Raga Rockers" },
      venue: { name: "Arena Lillomarka", city: { name: "Grorud", country: { name: "Norway" } } },
    }),
    { artistName: "Raga Rockers", eventDate: "2015-09-12", venue: "Arena Lillomarka", city: "Grorud", country: "Norway", eventName: null },
  );
  assert.equal(parseSetlistApi({ artist: { name: "X" } }), null);
});
