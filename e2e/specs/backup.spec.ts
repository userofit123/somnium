import { test, expect, daysAgo, writeDream, nav, navTo } from "../fixtures";
import { sql, userId } from "../db";
import { readFileSync } from "node:fs";

test("download a backup, restore it by merge into the same account with the password, counts match", async ({ app }) => {
  const { page, acct } = app;
  for (let i = 1; i <= 2; i++) await writeDream(page, { date: daysAgo(i), title: `Backup dream ${i}`, text: `Backup dream ${i}. I walked through a quiet market with my brother.` });
  const uid = userId(acct.username)!;
  await expect.poll(() => sql(`SELECT count(*) FROM dreams WHERE user_id = '${uid}'`)[0]![0], { timeout: 30_000 }).toBe("2");

  await navTo(page, "/settings/backup", page.getByRole("button", { name: /Download one now|Back up now/ }));
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download one now|Back up now/ }).click()]);
  const path = await dl.path();
  expect(dl.suggestedFilename()).toMatch(/\.somniumbackup$/);
  const body = readFileSync(path, "utf8");
  expect(body).not.toMatch(/quiet market|brother/); // sealed in the file

  // restore: merge, with the account's password
  await page.evaluate(() => { (window as any).__toasts = new Set(); new MutationObserver(() => document.querySelectorAll(".tst > div").forEach((e) => (window as any).__toasts.add((e as HTMLElement).innerText))).observe(document.body, { childList: true, subtree: true, characterData: true }); });
  await page.locator("input[type=file]").setInputFiles(path);
  await expect(page.locator("body")).toContainText("2 dreams");
  await page.getByRole("button", { name: /^Merge/ }).click();
  await page.locator("input[type=password]").fill(acct.password);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => page.evaluate(() => [...(window as any).__toasts].join(" | ")), { timeout: 30_000 }).toMatch(/Restored · \d+ dreams? · \d+ nights?/);
  // merge adds what's missing: still two dreams, here and on the server
  const n = () => sql(`SELECT count(*) FROM dreams WHERE user_id = '${uid}' AND deleted_at IS NULL`)[0]![0];
  await expect.poll(n, { timeout: 30_000 }).toBe("2");
  await nav(page, "/journal");
  await expect(page.locator("#app")).toContainText("Backup dream 1");
  await expect(page.locator("#app")).toContainText("Backup dream 2");
});
