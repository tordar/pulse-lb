import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchListensSince, mergeNew, nextDelay, playingKey, toLiveListen, type LBListen } from "./lbBrowser";

const L = (ts: number, track = "t"): LBListen => ({
  listened_at: ts, track_metadata: { track_name: track, artist_name: "a", release_name: "r",
    additional_info: { duration_ms: 1000, recording_mbid: null }, mbid_mapping: { recording_mbid: "m" } },
});

test("nextDelay backs off 15s → 60s → 5min", () => {
  assert.deepEqual([0, 1, 2, 9].map(nextDelay), [15_000, 60_000, 300_000, 300_000]);
});

test("toLiveListen prefers mapped recording mbid and ISO time", () => {
  const live = toLiveListen(L(1_700_000_000));
  assert.equal(live.recording_mbid, "m");
  assert.equal(live.listened_at, new Date(1_700_000_000_000).toISOString());
  assert.equal(live.duration_ms, 1000);
});

test("mergeNew keeps two tracks in the same second and drops repeats", () => {
  const seen = new Set<string>();
  const a = toLiveListen(L(10, "x")); const b = toLiveListen(L(10, "y"));
  assert.equal(mergeNew(seen, [a, b]).length, 2);
  assert.equal(mergeNew(seen, [a, b]).length, 0);
});

test("fetchListensSince pages forward until a short page", async () => {
  const calls: string[] = [];
  const pages = [Array.from({ length: 1000 }, (_, i) => L(2000 - i)), [L(2500)]];
  const fake = (async (url: string) => {
    calls.push(url);
    return new Response(JSON.stringify({ payload: { count: 0, listens: pages.shift() ?? [] } }));
  }) as typeof fetch;
  const got = await fetchListensSince("u", 1000, fake);
  assert.equal(got.length, 1001);
  assert.match(calls[0], /min_ts=1000/);
  assert.match(calls[1], /min_ts=2000/);
  assert.equal(got[0].listened_at, 2500, "newest first");
});

test("playingKey tells tracks apart and treats nothing-playing as empty", () => {
  const a = { track_name: "White Child", artist_name: "x", release_name: "r" };
  const b = { track_name: "Sixteen", artist_name: "x", release_name: "r" };
  assert.notEqual(playingKey(a), playingKey(b));
  assert.equal(playingKey({ ...a, caa_id: 1 }), playingKey(a));
  assert.equal(playingKey(null), "");
});
