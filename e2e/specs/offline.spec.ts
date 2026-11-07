import { test, expect, daysAgo, writeDream, nav } from "../fixtures";
import { sql, userId } from "../db";

// The built app's service worker and the on-device copy let a dream be written with no connection.
test.skip(({ isMobile }) => isMobile, "desktop only");

test("go offline, write a dream, come back: it syncs", async ({ app, context }) => {
  const { page, acct } = app;
  // the worker takes control, gets its file list (3 s after load) and the device copy opens
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 30_000 });
  await page.waitForFunction(() => Object.keys(localStorage).some((k) => k.startsWith("somniumUnsent:somnium-r-")), null, { timeout: 60_000 });
  await page.waitForTimeout(9000);

  await context.setOffline(true);
  await writeDream(page, { date: daysAgo(2), title: "Written offline", text: "I was walking in a quiet field with my cousin, offline all the while." });
  const uid = userId(acct.username)!;
  expect(sql(`SELECT count(*) FROM dreams WHERE user_id = '${uid}'`)[0]![0]).toBe("0");

  await context.setOffline(false);
  await expect.poll(() => sql(`SELECT count(*) FROM dreams WHERE user_id = '${uid}'`)[0]![0], { timeout: 60_000 }).toBe("1");
  await expect(page.locator(".syncpill")).toHaveCount(0, { timeout: 60_000 });
  await nav(page, "/journal");
  await expect(page.locator("#app")).toContainText("Written offline");
});
