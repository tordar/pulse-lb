import { test } from "node:test";
import assert from "node:assert/strict";
import { listenToRow } from "./syncUser";
import type { Listen } from "@/lib/listenbrainz/client";

const listen = (additional_info: Record<string, unknown>, mbid_mapping: Record<string, unknown>): Listen => ({
  listened_at: 1_700_000_000,
  track_metadata: { track_name: "Society", artist_name: "Eddie Vedder", release_name: "Into the Wild", additional_info, mbid_mapping },
});
const MAPPED = { release_mbid: "earthling", release_group_mbid: "earthling-rg", caa_id: 1, caa_release_mbid: "earthling" };

test("listenToRow prefers the scrobbled release and drops the mapper's cover for another album", () => {
  const r = listenToRow("u", listen({ release_mbid: "itw", release_group_mbid: "itw-rg" }, MAPPED));
  assert.equal(r.releaseMbid, "itw");
  assert.equal(r.releaseGroupMbid, "itw-rg");
  assert.equal(r.caaId, null);
  assert.equal(r.caaReleaseMbid, null);
});

test("listenToRow doesn't borrow the mapper's release group for a different release", () => {
  const r = listenToRow("u", listen({ release_mbid: "itw" }, MAPPED));
  assert.equal(r.releaseGroupMbid, null);
  assert.equal(r.caaId, null);
});

test("listenToRow keeps the mapper's cover for another edition of the same album", () => {
  const r = listenToRow("u", listen({ release_mbid: "itw-uk", release_group_mbid: "itw-rg" },
    { release_mbid: "itw-us", release_group_mbid: "itw-rg", caa_id: 2, caa_release_mbid: "itw-us" }));
  assert.equal(r.releaseMbid, "itw-uk");
  assert.equal(r.caaId, 2);
});

test("listenToRow falls back to the mapper when nothing was scrobbled", () => {
  const r = listenToRow("u", listen({}, MAPPED));
  assert.equal(r.releaseMbid, "earthling");
  assert.equal(r.releaseGroupMbid, "earthling-rg");
  assert.equal(r.caaId, 1);
});
