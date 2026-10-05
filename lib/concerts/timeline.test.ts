import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTimeline } from "./timeline";
import type { Concert, Festival } from "@/lib/db/schema";

const c = (id: string, eventDate: string, festivalId: string | null = null) =>
  ({ id, eventDate, artistName: id, festivalId }) as Concert;
const f = (id: string, startDate: string, endDate: string) =>
  ({ id, name: id, startDate, endDate }) as Festival;

test("groups by year newest first, festivals collapse their concerts by day", () => {
  const years = buildTimeline(
    [c("a", "2019-08-08", "oya"), c("b", "2019-08-07", "oya"), c("c", "2019-08-08", "oya"),
     c("d", "2019-09-01"), c("e", "2018-05-05")],
    [f("oya", "2019-08-07", "2019-08-10")],
  );
  assert.deepEqual(years.map((y) => y.year), [2019, 2018]);
  const [sep, oya] = years[0].entries;
  assert.equal(sep.kind, "concert");
  assert.equal(oya.kind, "festival");
  if (oya.kind !== "festival") throw new Error();
  assert.deepEqual(oya.days.map((d) => [d.date, d.concerts.map((x) => x.id)]), [
    ["2019-08-07", ["b"]],
    ["2019-08-08", ["a", "c"]],
  ]);
});

test("a festival with no concerts still appears", () => {
  const years = buildTimeline([], [f("empty", "2020-06-01", "2020-06-02")]);
  assert.equal(years[0].entries[0].kind, "festival");
});

test("several standalone concerts on one night stay separate entries", () => {
  const years = buildTimeline([c("a", "2019-01-01"), c("b", "2019-01-01")], []);
  assert.equal(years[0].entries.length, 2);
});
