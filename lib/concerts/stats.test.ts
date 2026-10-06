import { test } from "node:test";
import assert from "node:assert/strict";
import { concertStats } from "./stats";
import type { Concert } from "@/lib/db/schema";

const c = (artistName: string, artistMbid: string | null = null) => ({ artistName, artistMbid }) as Concert;

test("counts shows, distinct artists and the most-seen artist", () => {
  const s = concertStats([c("Honningbarna", "h"), c("honningbarna"), c("AURORA", "a"), c("Honningbarna", "h")], 3);
  assert.deepEqual(s, { shows: 4, artists: 2, festivals: 3, mostSeen: { name: "Honningbarna", mbid: "h", count: 3 } });
});

test("no most-seen artist when nobody was seen twice", () => {
  assert.equal(concertStats([c("A"), c("B")], 0).mostSeen, null);
});
