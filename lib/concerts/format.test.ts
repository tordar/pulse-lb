import { test } from "node:test";
import assert from "node:assert/strict";
import { fmtConcertDate, fmtDay, fmtRange } from "./format";

test("fmtConcertDate", () => assert.equal(fmtConcertDate("2019-08-08"), "8 Aug 2019"));
test("fmtDay", () => assert.equal(fmtDay("2019-08-08"), "Thu 8 Aug"));
test("fmtRange same month", () => assert.equal(fmtRange("2019-08-07", "2019-08-10"), "7–10 Aug 2019"));
test("fmtRange across months", () => assert.equal(fmtRange("2019-07-30", "2019-08-02"), "30 Jul – 2 Aug 2019"));
test("fmtRange across years", () => assert.equal(fmtRange("2019-12-31", "2020-01-01"), "31 Dec 2019 – 1 Jan 2020"));
test("fmtRange single day", () => assert.equal(fmtRange("2019-08-08", "2019-08-08"), "8 Aug 2019"));
