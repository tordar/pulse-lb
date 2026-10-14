import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPayload, parseTs } from "./build";
import { OTHER_ARTIST } from "./payload";

test("ranks named artists, maps the rest to OTHER_ARTIST, keeps order", () => {
  const p = buildPayload("u", "UTC", [
    { ts: 10, artist: "B" }, { ts: 20, artist: "A" }, { ts: 30, artist: "Z" },
  ], ["A", "B"])!;
  assert.deepEqual([...p.ts], [10, 20, 30]);
  assert.deepEqual([...p.artist], [1, 0, OTHER_ARTIST]);
  assert.deepEqual(p.header, { user: "u", n: 3, tz: "UTC", artists: ["A", "B"], firstTs: 10, lastTs: 30 });
});

test("no listens → null", () => {
  assert.equal(buildPayload("u", "UTC", [], []), null);
});

test("parseTs accepts positive integers only", () => {
  assert.equal(parseTs("1700000000"), 1700000000);
  for (const bad of [null, "", "abc", "-5", "1.5", "0", "1e9", "99999999999"]) assert.equal(parseTs(bad), null, String(bad));
});
