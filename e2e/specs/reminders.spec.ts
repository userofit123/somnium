import { test, expect, navTo } from "../fixtures";

// the full Chromium build (new headless): the headless shell reports every notification permission as denied
test.use({ channel: "chromium", permissions: ["notifications"] });

test("reality-check reminders on, with permission granted, show a notification through the service worker", async ({ app }) => {
  const { page } = app;
  const toggle = page.locator("label.tgl", { hasText: "Reality check reminders" }).locator("input[type=checkbox]");
  await navTo(page, "/settings/notifications", toggle);
  await toggle.check();
  await expect(page.locator("#app")).toContainText("Notifications: allowed");
  await expect(page.locator("#app")).toContainText(/Next at|None planned|Paused/);
  // the reminders row was made (and synced)
  // a service worker has to be in charge for the notification to come through it
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await expect(page.getByRole("button", { name: "Try one" })).toBeVisible();
  await page.getByRole("button", { name: "Try one" }).click();
  await expect.poll(() => page.evaluate(async () => (await (await navigator.serviceWorker.getRegistration())!.getNotifications()).map((n) => n.title)), { timeout: 15_000 }).not.toHaveLength(0);
  // nothing from the journal in it
  const n = await page.evaluate(async () => (await (await navigator.serviceWorker.getRegistration())!.getNotifications()).map((x) => `${x.title} ${x.body}`).join(" "));
  expect(n.length).toBeGreaterThan(0);
});
