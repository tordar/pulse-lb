import { test } from "node:test";
import assert from "node:assert/strict";
import { OTHER_ARTIST, type LandingPayload } from "./payload";
import {
  callouts, countMatches, dayStr, filterLabel, filterUniforms, heightAt, livePoint, localize, matches,
  minStr, prepare, punchCard, topArtists, yearCounts, yearStartDay,
} from "./derive";

const s = (iso: string) => Date.parse(iso) / 1000;

function payload(isoList: string[], artists: number[], tz = "Europe/Oslo"): LandingPayload {
  const ts = Uint32Array.from(isoList.map(s));
  return {
    header: { user: "u", n: ts.length, tz, artists: ["A", "B", "C"], firstTs: ts[0] ?? 0, lastTs: ts[ts.length - 1] ?? 0 },
    ts, artist: Uint16Array.from(artists),
  };
}

test("localize: 22:30Z in summer is 00:30 next day in Oslo", () => {
  const l = localize(Uint32Array.from([s("2024-07-01T10:00:00Z"), s("2024-07-01T22:30:00Z")]), "Europe/Oslo");
  assert.equal(dayStr(l.baseMs, l.day[0]), "2024-07-01");
  assert.equal(dayStr(l.baseMs, l.day[1]), "2024-07-02");
  assert.equal(l.minute[1], 30);
  assert.equal(minStr(l.minute[0]), "12:00");
  assert.equal(l.maxDay, 1);
});

test("localize: UTC is identity", () => {
  const l = localize(Uint32Array.from([s("2020-01-01T23:59:00Z")]), "UTC");
  assert.equal(dayStr(l.baseMs, l.day[0]), "2020-01-01");
  assert.equal(l.minute[0], 23 * 60 + 59);
});

test("New Year's Eve 23:30Z counts for the new year in Oslo", () => {
  const p = prepare(payload(["2024-06-01T12:00:00Z", "2024-12-31T23:30:00Z"], [0, 1]));
  const years = yearCounts(p);
  assert.equal(years.get(2024), 1);
  assert.equal(years.get(2025), 1);
  const y2025 = { kind: "year" as const, year: 2025, from: yearStartDay(p.baseMs, 2025), to: yearStartDay(p.baseMs, 2026) };
  assert.equal(matches(y2025, p, 1), true);
  assert.equal(matches(y2025, p, 0), false);
  assert.equal(countMatches(y2025, p), 1);
});

test("punch card uses local weekday and hour (Mon=0)", () => {
  // 2024-07-01 is a Monday; 22:30Z is Tuesday 00:30 in Oslo.
  const p = prepare(payload(["2024-07-01T10:00:00Z", "2024-07-01T22:30:00Z"], [0, 0]));
  const pc = punchCard(p);
  assert.equal(pc[0][12], 1);
  assert.equal(pc[1][0], 1);
  assert.equal(matches({ kind: "slot", weekday: 1, hour: 0 }, p, 1), true);
  assert.equal(matches({ kind: "slot", weekday: 1, hour: 0 }, p, 0), false);
});

test("top artists skip OTHER_ARTIST and sort by count", () => {
  const p = prepare(payload(
    ["2024-01-01T10:00:00Z", "2024-01-01T11:00:00Z", "2024-01-01T12:00:00Z", "2024-01-01T13:00:00Z"],
    [1, 1, 0, OTHER_ARTIST],
  ));
  assert.deepEqual(topArtists(p, 5), [{ rank: 1, name: "B", count: 2 }, { rank: 0, name: "A", count: 1 }]);
  assert.equal(matches({ kind: "artist", rank: 1 }, p, 0), true);
  assert.equal(filterLabel({ kind: "artist", rank: 1 }, p), "B");
});

test("callouts: peak day, quietest full year, first listen", () => {
  const iso = [
    "2019-12-31T12:00:00Z",                                            // partial first year
    "2020-03-01T10:00:00Z", "2020-03-01T11:00:00Z", "2020-03-01T12:00:00Z", // peak day, 2020 = 3
    "2021-05-05T10:00:00Z",                                            // quietest full year = 1
    "2022-01-01T10:00:00Z", "2022-02-01T10:00:00Z",                    // 2022 = 2
    "2023-01-01T10:00:00Z",                                            // partial last year
  ];
  const p = prepare(payload(iso, iso.map(() => 0)));
  const byKey = Object.fromEntries(callouts(p).map((c) => [c.key, c]));
  assert.equal(byKey.peak.value, "01/03/2020 · 3 LISTENS");
  assert.equal(byKey.quiet.value, "2021 · 1 LISTENS");
  assert.equal(byKey.first.value, "31/12/2019");
  assert.equal(byKey.first.index, 0);
});

test("callouts omit quietest year when there is no full year", () => {
  const p = prepare(payload(["2024-01-01T10:00:00Z", "2024-02-01T10:00:00Z"], [0, 0]));
  assert.equal(callouts(p).some((c) => c.key === "quiet"), false);
});

test("heightfield peaks where listens cluster, normalized to 0..1", () => {
  const iso = Array.from({ length: 50 }, (_, i) => `2024-01-${String(1 + (i % 2)).padStart(2, "0")}T20:00:00Z`)
    .concat(["2024-12-31T05:00:00Z"]);
  const p = prepare(payload(iso, iso.map(() => 0)));
  const hot = heightAt(p.hf, 0.003, 21 / 24);
  const cold = heightAt(p.hf, 0.5, 0.25);
  assert.ok(hot > 0.5 && hot <= 1, `hot=${hot}`);
  assert.ok(cold < 0.05, `cold=${cold}`);
});

test("filterUniforms maps each kind", () => {
  assert.deepEqual(filterUniforms(null), { uF: 0, uA: 0, uB: 0 });
  assert.deepEqual(filterUniforms({ kind: "slot", weekday: 3, hour: 23 }), { uF: 1, uA: 3, uB: 23 });
  assert.deepEqual(filterUniforms({ kind: "year", year: 2020, from: 10, to: 20 }), { uF: 2, uA: 10, uB: 20 });
  assert.deepEqual(filterUniforms({ kind: "artist", rank: 4 }), { uF: 3, uA: 4, uB: 0 });
});

test("livePoint: a listen after the payload lands on the payload's day axis in local time", () => {
  const p = prepare(payload(["2024-07-01T10:00:00Z", "2024-07-03T10:00:00Z"], [0, 1]));
  const lp = livePoint(p, s("2024-07-04T22:30:00Z"), "B");
  assert.equal(dayStr(p.baseMs, lp.day), "2024-07-05");
  assert.equal(lp.day, p.maxDay + 2);
  assert.equal(lp.minute, 30);
  assert.equal(lp.artist, 1);
  assert.equal(livePoint(p, s("2024-07-04T10:00:00Z"), "Nobody").artist, OTHER_ARTIST);
});
