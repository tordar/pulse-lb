import { test } from "@playwright/test";

// Time from tapping a tab to the first real list row, and from a cold
// navigation to first content. Logs numbers; asserts nothing. Run against prod
// (BASE_URL=https://pulse.tordar.no) before and after the migration.
const TABS = [
  { from: "/u/tordar/artists", to: "Songs", row: "/u/tordar/songs/" },
  { from: "/u/tordar/songs", to: "Albums", row: "/u/tordar/albums/" },
  { from: "/u/tordar/albums", to: "Concerts", row: "/u/tordar/artists/" },
];

test("tab switch: tap → first real row", async ({ page }, info) => {
  for (const t of TABS) {
    await page.goto(t.from, { waitUntil: "load" });
    await page.waitForTimeout(2500); // let viewport prefetches finish
    const nav = info.project.name === "phone" ? page.locator("nav[aria-label=Sections]").last() : page.locator("nav[aria-label=Sections]").first();
    const t0 = Date.now();
    await nav.getByRole("link", { name: t.to }).click();
    await page.locator(`main a[href^="${t.row}"], a[href^="${t.row}"]`).first().waitFor();
    console.log(`MEASURE ${info.project.name} ${t.from} → ${t.to}: ${Date.now() - t0} ms`);
  }
});

test("cold load: /u/tordar/artists", async ({ page }, info) => {
  const t0 = Date.now();
  const res = await page.goto("/u/tordar/artists", { waitUntil: "commit" });
  const ttfb = Date.now() - t0;
  await page.locator('a[href^="/u/tordar/artists/"]').first().waitFor();
  console.log(`MEASURE ${info.project.name} cold artists: ttfb ${ttfb} ms, content ${Date.now() - t0} ms, status ${res?.status()}`);
});
