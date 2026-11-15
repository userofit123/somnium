import { test, expect, navTo } from "../fixtures";

// the full Chromium build (new headless): the headless shell reports every notification permission as denied
test.use({ channel: "chromium", permissions: ["notifications"] });

test("reality-check reminders on, with permission granted, show a notification through the service worker", async ({ app }, info) => {
  const { page } = app;
  // Settings, Reality checks: the switch plans the day's checks
  const toggle = page.locator("label.tgl", { hasText: "Reality check reminders" }).locator("input[type=checkbox]");
  await navTo(page, "/settings/reality-checks", toggle);
  await toggle.check();
  await expect(page.locator("#app")).toContainText(/Next at|None planned|Paused/);

  // Settings, Reminders: the reality checks row shows them on, and says whether reminders arrive in this browser
  const rcSwitch = page.getByRole("checkbox", { name: "Reality checks", exact: true });
  await navTo(page, "/settings/reminders", rcSwitch);
  await expect(rcSwitch).toBeChecked();
  await expect(page.locator("#app")).toContainText("Only while Somnium is open");

  if (info.project.name === "phone") {
    // a phone browser stops pages in the background, so the one fix offered is the Android app, not a test
    await expect(page.getByRole("button", { name: "Get the Android app" })).toBeVisible();
  } else {
    // a service worker has to be in charge for the notification to come through it
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await page.getByRole("button", { name: "Send a test" }).click();
    await expect.poll(() => page.evaluate(async () => (await (await navigator.serviceWorker.getRegistration())!.getNotifications()).map((n) => n.title)), { timeout: 15_000 }).not.toHaveLength(0);
    // nothing from the journal in it
    const n = await page.evaluate(async () => (await (await navigator.serviceWorker.getRegistration())!.getNotifications()).map((x) => `${x.title} ${x.body}`).join(" "));
    expect(n.length).toBeGreaterThan(0);
  }

  // the reasons behind "?" read the permission as allowed
  await page.getByRole("button", { name: "About reminders on this device" }).click();
  await expect(page.locator("body")).toContainText("Notifications: allowed");
});
