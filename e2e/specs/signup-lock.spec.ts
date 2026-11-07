import { test, expect, signUp, waitOpen, unlock } from "../fixtures";
import { sql } from "../db";

test("sign up, make the recovery key, lock on reload, unlock, five wrong tries wait", async ({ page, acct }) => {
  const key = await signUp(page, acct);
  expect(key).toMatch(/^[A-Z0-9]{4}(-[A-Z0-9]{4}){4}$/);

  // a reload closes the key: the lock shows and nothing of the app is behind it
  await page.reload();
  await expect(page.locator(".lock-screen")).toBeVisible();
  expect(await page.locator("nav, .rail, main").count()).toBe(0);

  // five wrong tries: the wait shows, the journal stays locked, and nothing is deleted
  for (let i = 1; i <= 4; i++) {
    await unlock(page, `wrong-try-${i}-xxxxxxx`);
    await expect(page.locator(".lock-screen .err")).toContainText(`${5 - i} ${i === 4 ? "try" : "tries"} left`);
  }
  await unlock(page, "wrong-try-5-xxxxxxx");
  await expect(page.locator(".lock-screen")).toContainText(/Too many wrong tries\. Try again in/);
  await expect(page.locator(".lock-screen")).toContainText("Your journal stays locked");
  expect(sql(`SELECT count(*) FROM users WHERE username = '${acct.username}'`)[0]![0]).toBe("1");
  // while the wait runs the Unlock button is off, so even the right password is not tried
  await expect(page.getByRole("button", { name: "Unlock", exact: true })).toBeDisabled();

  // the wait ends (the tries live in the page's storage; this is the wait's own clock, moved back)
  await page.evaluate(() => { const k = "somniumLockTries"; const v = JSON.parse(localStorage.getItem(k) || "{}"); localStorage.setItem(k, JSON.stringify({ ...v, lastAt: Date.now() - 3_600_000 })); });
  await page.reload();
  await expect(page.locator("#lock-pw")).toBeVisible();
  await unlock(page, acct.password);
  await waitOpen(page);
  await expect(page.locator(".lock-screen")).toHaveCount(0);
});
