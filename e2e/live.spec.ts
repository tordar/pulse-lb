import { test, expect } from "@playwright/test";

const USER = "tordar";
const NEW_TRACK = `E2E Live ${Date.now()}`;

function lbListen(ts: number) {
  return { listened_at: ts, track_metadata: { track_name: NEW_TRACK, artist_name: "E2E Artist",
    release_name: "E2E Album", additional_info: { duration_ms: 200000 }, mbid_mapping: {} } };
}

test("a new listen appears before ingest finishes", async ({ page }) => {
  const now = Math.floor(Date.now() / 1000);
  await page.route("https://api.listenbrainz.org/1/user/*/playing-now", (r) =>
    r.fulfill({ json: { payload: { listens: [], playing_now: false } } }));
  await page.route("https://api.listenbrainz.org/1/user/*/listens*", (r) =>
    r.fulfill({ json: { payload: { count: 1, listens: [lbListen(now)] } } }));
  // Hold the ingest response so we can prove the row shows without it.
  let release!: () => void;
  const held = new Promise<void>((res) => (release = res));
  await page.route("**/api/listens/ingest/**", async (r) => { await held; await r.fulfill({ json: { mode: "skipped" } }); });

  await page.goto(`/u/${USER}/stats`);
  await expect(page.getByText(NEW_TRACK).first()).toBeVisible({ timeout: 10_000 });
  release();
});

test("402 stops further ingest calls and keeps the projection", async ({ page }) => {
  const now = Math.floor(Date.now() / 1000);
  let ingestCalls = 0;
  let ts = now;
  await page.route("https://api.listenbrainz.org/1/user/*/playing-now", (r) =>
    r.fulfill({ json: { payload: { listens: [], playing_now: false } } }));
  await page.route("https://api.listenbrainz.org/1/user/*/listens*", (r) =>
    r.fulfill({ json: { payload: { count: 1, listens: [lbListen(++ts)] } } }));
  await page.route("**/api/listens/ingest/**", (r) => { ingestCalls++; return r.fulfill({ status: 402, json: {} }); });

  await page.clock.install();
  await page.goto(`/u/${USER}/stats`);
  await expect(page.getByText(NEW_TRACK).first()).toBeVisible();
  await page.clock.runFor(45_000); // three more polls
  expect(ingestCalls).toBe(1);
  await expect(page.getByText(NEW_TRACK).first()).toBeVisible();
});
