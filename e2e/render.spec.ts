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

test("artists ?q= filters and ?view=list switches layout", async ({ page }) => {
  await page.goto("/u/tordar/artists?q=radiohead&view=list", { waitUntil: "load" });
  const rows = page.locator('ol a[href^="/u/tordar/artists/"]');
  await expect(rows.first()).toBeVisible();
  await expect(rows.first()).toContainText(/radiohead/i);
  await page.goto("/u/tordar/artists?q=zzzz-no-match", { waitUntil: "load" });
  await expect(page.getByText('No artists match "zzzz-no-match".')).toBeVisible();
});

test("unknown username renders empty list states", async ({ page }) => {
  for (const kind of ["songs", "albums", "artists"]) {
    const res = await page.goto(`/u/nobody-xyz-404/${kind}`, { waitUntil: "load" });
    expect(res?.status()).toBeLessThan(500);
    await expect(page.getByText(new RegExp(`No ${kind} yet`))).toBeVisible();
  }
});

test("unknown detail ids show the not-found UI", async ({ page }) => {
  const zero = "00000000-0000-0000-0000-000000000000";
  for (const kind of ["artists", "albums", "songs"]) {
    await page.goto(`/u/tordar/${kind}/${zero}`, { waitUntil: "load" });
    await expect(page.locator("body")).toContainText(/could not be found|not found/i, { timeout: 15_000 });
  }
});

test("concerts: visitor sees the list but no owner controls", async ({ page }) => {
  await page.goto("/u/tordar/concerts", { waitUntil: "load" });
  await expect(page.getByText("Shows", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add concert" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
});

test("concerts: owner gets the bar and edit mode", async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "pulse_session", value: fx.tok, url: baseURL! }]);
  await page.goto("/u/tordar/concerts", { waitUntil: "load" });
  await expect(page.getByRole("button", { name: "Add concert" })).toBeVisible();
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "Done" })).toBeVisible();
  expect(await page.getByRole("button", { name: "Edit", exact: true }).count()).toBeGreaterThan(10);
});

test("concerts: unknown user renders the empty state", async ({ page }) => {
  const res = await page.goto("/u/nobody-xyz-404/concerts", { waitUntil: "load" });
  expect(res?.status()).toBeLessThan(500);
  await expect(page.getByText("No concerts yet.")).toBeVisible();
});
