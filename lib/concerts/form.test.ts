import { test } from "node:test";
import assert from "node:assert/strict";
import { parseConcertForm, parseFestivalForm, dateInRange } from "./form";

const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

test("valid concert, blanks → null, empty id → null", () => {
  const r = parseConcertForm(fd({ id: "", eventDate: "2019-08-08", artistName: " Robyn ", venue: "", setlistUrl: "" }));
  assert.deepEqual(r, {
    ok: true,
    value: { id: null, eventDate: "2019-08-08", artistName: "Robyn", venue: null, city: null,
      country: null, notes: null, setlistUrl: null, festivalId: null },
  });
});

test("concert requires artist and a real date", () => {
  assert.equal(parseConcertForm(fd({ eventDate: "2019-08-08", artistName: "  " })).ok, false);
  assert.equal(parseConcertForm(fd({ eventDate: "2019-02-30", artistName: "X" })).ok, false);
  assert.equal(parseConcertForm(fd({ eventDate: "08/08/2019", artistName: "X" })).ok, false);
});

test("setlist url must be http(s)", () => {
  assert.equal(parseConcertForm(fd({ eventDate: "2019-08-08", artistName: "X", setlistUrl: "javascript:alert(1)" })).ok, false);
  assert.equal(parseConcertForm(fd({ eventDate: "2019-08-08", artistName: "X", setlistUrl: "https://setlist.fm/a" })).ok, true);
});

test("festival requires name and end >= start", () => {
  assert.equal(parseFestivalForm(fd({ name: "Øya", startDate: "2019-08-10", endDate: "2019-08-07" })).ok, false);
  assert.equal(parseFestivalForm(fd({ name: "", startDate: "2019-08-07", endDate: "2019-08-10" })).ok, false);
  assert.equal(parseFestivalForm(fd({ name: "Øya", startDate: "2019-08-07", endDate: "2019-08-07" })).ok, true);
});

test("dateInRange is inclusive", () => {
  assert.equal(dateInRange("2019-08-07", "2019-08-07", "2019-08-10"), true);
  assert.equal(dateInRange("2019-08-10", "2019-08-07", "2019-08-10"), true);
  assert.equal(dateInRange("2019-08-11", "2019-08-07", "2019-08-10"), false);
});

test("non-UUID ids are rejected", () => {
  assert.equal(parseConcertForm(fd({ id: "nope", eventDate: "2019-08-08", artistName: "X" })).ok, false);
  assert.equal(parseConcertForm(fd({ festivalId: "nope", eventDate: "2019-08-08", artistName: "X" })).ok, false);
  assert.equal(parseFestivalForm(fd({ id: "nope", name: "Øya", startDate: "2019-08-07", endDate: "2019-08-07" })).ok, false);
});
