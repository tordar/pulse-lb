import { defineConfig } from "@playwright/test";

// Runs against an already-running server: `next start` locally (with the prod
// .env copied in) or prod itself. BASE_URL picks which.
export default defineConfig({
  testDir: ".",
  timeout: 60_000,
  workers: 1,
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3457",
    colorScheme: "dark",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1100, height: 900 } } },
    { name: "phone", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
});
