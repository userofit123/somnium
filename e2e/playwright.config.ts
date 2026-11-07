// End-to-end tests (LDJ-43): the built app served by the server (default http://127.0.0.1:8801, the dev "phone"
// build), driven in desktop Chromium and a phone-sized touch viewport. Every test makes its own fresh account through
// an invite the harness inserts into the database (see fixtures.ts) and deletes it afterwards.
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./specs",
  outputDir: "./test-results",
  // one account per test and one server: run one at a time so the server's sign-in limits and sync stay predictable
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: "./report" }]] : [["list"]],
  globalTeardown: "./global-teardown.ts",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:8801",
    actionTimeout: 20_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    // the phone project is Chromium too (the only browser installed in CI), with touch and a 390x844 screen
    { name: "phone", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 } },
  ],
});
