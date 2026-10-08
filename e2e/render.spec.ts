import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

const fx = JSON.parse(readFileSync(process.env.E2E_FIXTURES!, "utf8")) as {
  tok: string; artist: string; release: string; rec: string;
};

// Run against a local DB only: the owner's ingest probe can rebuild aggregates.
export const PAGES = [
  "/",
  "/u/tordar/songs",
  "/u/tordar/albums",
  "/u/tordar/artists",
  "/u/tordar/concerts",
  "/u/tordar/stats",
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

test("stats (visitor) renders and deep-links to a year and day", async ({ page }) => {
  await check(page, "/u/tordar/stats");
  await expect(page.getByText("listening time")).toBeVisible();
  await expect(page.getByText("Recent listens")).toBeVisible();
  await page.goto("/u/tordar/stats?year=2019&day=2019-06-01", { waitUntil: "load" });
  await expect(page.getByText("Saturday, June 1, 2019")).toBeVisible();
  await expect(page.getByRole("button", { name: /sync/i })).toHaveCount(0);
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

test("home: visitor sees Sign in, owner sees Signed in as", async ({ page, context, baseURL }) => {
  await page.goto("/", { waitUntil: "load" });
  await expect(page.getByText("Sign in with ListenBrainz")).toBeVisible();
  await expect(page.getByText(/Signed in as/)).toHaveCount(0);
  await context.addCookies([{ name: "pulse_session", value: fx.tok, url: baseURL! }]);
  await page.goto("/", { waitUntil: "load" });
  await expect(page.getByText(/Signed in as/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
});

test("home ?error=upstream shows the banner; onboarding ?error=notfound too", async ({ page }) => {
  await page.goto("/?error=upstream", { waitUntil: "load" });
  await expect(page.getByText("ListenBrainz looks unreachable right now.")).toBeVisible();
  await page.goto("/onboarding?error=notfound&username=zz", { waitUntil: "load" });
  await expect(page.getByText(/couldn.t find/)).toBeVisible();
});
