import { test } from "node:test";
import assert from "node:assert/strict";
import { isOwner } from "./owner";

test("isOwner only for the matching session", () => {
  assert.equal(isOwner({ lbUsername: "tordar" }, "tordar"), true);
  assert.equal(isOwner({ lbUsername: "someone" }, "tordar"), false);
  assert.equal(isOwner(null, "tordar"), false);
});
