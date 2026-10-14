import { test } from "node:test";
import assert from "node:assert/strict";
import { decodePayload, encodePayload, OTHER_ARTIST, type LandingPayload } from "./payload";

const sample = (n: number, artists: string[]): LandingPayload => ({
  header: { user: "tordar", n, tz: "Europe/Oslo", artists, firstTs: n ? 1_250_000_000 : 0, lastTs: n ? 1_250_000_000 + n : 0 },
  ts: Uint32Array.from({ length: n }, (_, i) => 1_250_000_000 + i),
  artist: Uint16Array.from({ length: n }, (_, i) => (i % 3 === 2 ? OTHER_ARTIST : i % 3)),
});

const toArrayBuffer = (u: Uint8Array) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

test("round-trips header and both columns", () => {
  const p = sample(7, ["Radiohead", "Bon Iver"]);
  const back = decodePayload(toArrayBuffer(encodePayload(p)));
  assert.deepEqual(back.header, p.header);
  assert.deepEqual([...back.ts], [...p.ts]);
  assert.deepEqual([...back.artist], [...p.artist]);
});

test("keeps quotes, emoji, CJK and empty artist names intact", () => {
  const names = ['Sigur Rós', 'The "Band"', "坂本龍一", "🎧 dj", ""];
  const back = decodePayload(toArrayBuffer(encodePayload(sample(3, names))));
  assert.deepEqual(back.header.artists, names);
});

test("header lengths that are not a multiple of 4 still align the columns", () => {
  for (const extra of ["", "a", "ab", "abc"]) {
    const p = sample(5, ["x" + extra]);
    const back = decodePayload(toArrayBuffer(encodePayload(p)));
    assert.deepEqual([...back.ts], [...p.ts]);
  }
});

test("empty payload round-trips", () => {
  const back = decodePayload(toArrayBuffer(encodePayload(sample(0, []))));
  assert.equal(back.header.n, 0);
  assert.equal(back.ts.length, 0);
});

test("truncated buffer throws", () => {
  const bytes = encodePayload(sample(4, ["a"]));
  assert.throws(() => decodePayload(toArrayBuffer(bytes.slice(0, bytes.length - 3))), /bad landing payload/);
});
