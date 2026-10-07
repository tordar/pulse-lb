import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

const fx = JSON.parse(readFileSync(process.env.E2E_FIXTURES!, "utf8")) as {
  tok: string; artist: string; release: string; rec: string;
};

// Never /stats as owner locally: the owner's sync probe can rebuild prod
// aggregates. Visitor /stats joins this list in Task 6.
export const PAGES = [
  "/",
  "/u/tordar/songs",
  "/u/tordar/albums",
  "/u/tordar/artists",
  "/u/tordar/concerts",
  `/u/tordar/artists/${fx.artist}`,
  `/u/tordar/albums/${fx.release}`,
  `/u/tordar/songs/${fx.rec}`,
];

async function check(page: Page, path: string) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const res = await page.goto(path, { waitUntil: "load" });
  await page.waitForTimeout(1500);
  expect(res?.status(), path).toBeLessThan(500);
  await expect(page.locator("body")).not.toContainText(/Application error|Internal Server Error/);
  expect(errors, path).toEqual([]);
}

test.describe("visitor", () => {
  for (const path of PAGES) {
    test(`renders ${path}`, async ({ page }) => {
      await check(page, path);
      await expect(page.getByRole("link", { name: "Account settings" })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Account", exact: true })).toHaveCount(0);
    });
  }
});

test.describe("owner", () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await context.addCookies([{ name: "pulse_session", value: fx.tok, url: baseURL! }]);
  });
  for (const path of PAGES.filter((p) => p.startsWith("/u/"))) {
    test(`renders ${path} with owner controls`, async ({ page }, info) => {
      await check(page, path);
      const account = info.project.name === "phone"
        ? page.getByRole("link", { name: "Account settings" })
        : page.getByRole("link", { name: "Account", exact: true });
      await expect(account).toBeVisible();
    });
  }
});
