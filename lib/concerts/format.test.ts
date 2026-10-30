import { test } from "node:test";
import assert from "node:assert/strict";
import { fmtConcertDate, fmtDay, fmtRange } from "./format";

test("fmtConcertDate", () => assert.equal(fmtConcertDate("2019-08-08"), "08/08/2019"));
test("fmtDay", () => assert.equal(fmtDay("2019-08-08"), "Thu 08/08"));
test("fmtDay with year", () => assert.equal(fmtDay("2019-08-08", true), "Thu 08/08/2019"));
test("fmtRange", () => assert.equal(fmtRange("2019-12-31", "2020-01-01"), "31/12/2019 – 01/01/2020"));
test("fmtRange single day", () => assert.equal(fmtRange("2019-08-08", "2019-08-08"), "08/08/2019"));
