import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeArtist, buildArtistIndex, matchArtist } from "./match";

test("normalizeArtist folds case, accents, whitespace and leading 'the'", () => {
  assert.equal(normalizeArtist("  Sigur   Rós "), "sigur ros");
  assert.equal(normalizeArtist("The xx"), "xx");
  assert.equal(normalizeArtist("the XX"), "xx");
  assert.equal(normalizeArtist("Øya Band"), "øya band"); // ø has no decomposition; kept
});

test("matchArtist finds spelling variants", () => {
  const idx = buildArtistIndex([{ artistName: "Sigur Rós", mbid: "m1", plays: 10 }]);
  assert.equal(matchArtist(idx, "sigur ros")?.mbid, "m1");
  assert.equal(matchArtist(idx, "Sigur Rós")?.mbid, "m1");
});

test("matchArtist returns null for unknown artists and non-prefix 'the'", () => {
  const idx = buildArtistIndex([{ artistName: "The Band", mbid: "m1", plays: 1 }]);
  assert.equal(matchArtist(idx, "Bandits"), null);
  assert.equal(matchArtist(idx, "Theband"), null);
});

test("buildArtistIndex keeps the most-played artist when names collide", () => {
  const idx = buildArtistIndex([
    { artistName: "Nirvana", mbid: "small", plays: 3 },
    { artistName: "nirvana", mbid: "big", plays: 900 },
    { artistName: "NIRVANA", mbid: "mid", plays: 50 },
  ]);
  assert.equal(matchArtist(idx, "Nirvana")?.mbid, "big");
});
