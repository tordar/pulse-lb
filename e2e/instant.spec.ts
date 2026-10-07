import { test, expect } from "@playwright/test";
import { instant } from "@next/playwright";

// A tab switch must show real rows from the prefetch alone — no network wait.
const SWITCHES = [
  { from: "/u/tordar/artists", tab: "Songs", row: 'a[href^="/u/tordar/songs/"]' },
  { from: "/u/tordar/songs", tab: "Albums", row: 'a[href^="/u/tordar/albums/"]' },
  { from: "/u/tordar/albums", tab: "Artists", row: 'a[href^="/u/tordar/artists/"]' },
  { from: "/u/tordar/artists", tab: "Concerts", row: "text=Shows" },
];

for (const s of SWITCHES) {
  test(`instant: ${s.from} → ${s.tab}`, async ({ page }, info) => {
    // Cover art is irrelevant here, and slow covers hold all of the browser's
    // connections to the local server, starving the tab prefetches behind them.
    await page.route("**/api/cover/**", (r) => r.abort());
    const dest = `/u/tordar/${s.tab.toLowerCase()}`;
    // The full (stage-2) prefetch of the destination: an RSC request with no segment header.
    const prefetched = page.waitForResponse(
      (r) => {
        const h = r.request().headers();
        return r.url().includes(`${dest}?_rsc=`) && !!h["next-router-prefetch"] && !h["next-router-segment-prefetch"];
      },
      { timeout: 30_000 },
    );
    await page.goto(s.from, { waitUntil: "load" });
    await prefetched;
    await page.waitForTimeout(1500); // let the prefetch stream finish into the router cache
    const nav = page.locator("nav[aria-label=Sections]").nth(info.project.name === "phone" ? 1 : 0);
    await instant(page, async () => {
      await nav.getByRole("link", { name: s.tab }).click();
      await expect(page.locator(s.row).first()).toBeVisible();
    });
  });
}
