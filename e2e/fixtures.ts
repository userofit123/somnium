import { test as base, expect, type Locator, type Page } from "@playwright/test";
import { deleteUser, makeInvite } from "./db";

export { expect };
export const PASSWORD = "e2e-correct-horse-1";

export interface Account { username: string; password: string; invite: string }

/** A brand-new account name and an invite for it; the account is deleted, with all its rows, when the test ends. */
export const test = base.extend<{ acct: Account; app: { page: Page; acct: Account; recoveryKey: string } }>({
  acct: async ({}, use) => {
    const acct = { username: "e2e-" + Math.random().toString(36).slice(2, 9), password: PASSWORD, invite: makeInvite() };
    try { await use(acct); } finally { try { deleteUser(acct.username); } catch { /* the sweep in global teardown gets it */ } }
  },
  // a signed-up, unlocked app
  app: async ({ page, acct }, use) => {
    const recoveryKey = await signUp(page, acct);
    await use({ page, acct, recoveryKey });
  },
});

/** An input in the auth card, found by its label text (the labels are not tied to the inputs). */
const fld = (page: Page, label: string) => page.locator(".fld", { has: page.locator("label", { hasText: new RegExp(`^${label}$`) }) }).locator("input");

/** The create-account form, the recovery key step, and into the app. Returns the recovery key. */
export async function signUp(page: Page, a: Account): Promise<string> {
  await page.goto("/");
  await page.getByText("Have an invite? Create an account").click();
  await fld(page, "Username").fill(a.username);
  await fld(page, "Password").fill(a.password);
  await fld(page, "Invite code").fill(a.invite);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByRole("button", { name: "Make recovery key" }).click();
  const key = (await page.locator(".key-display").innerText()).trim();
  await page.getByLabel("I saved my recovery key").check();
  await page.getByRole("button", { name: "Continue" }).click();
  await waitOpen(page);
  // the app is still starting (first sync, the device copy, the dream lexicons): a navigation now can be swallowed
  await page.waitForTimeout(4000);
  return key;
}

/** The app is showing (no sign-in, lock or splash screen). */
export const waitOpen = (page: Page) => page.waitForFunction(() => !document.querySelector(".lock-screen") && !document.querySelector(".auth") && !document.getElementById("splash") && !!document.querySelector("#app *"), null, { timeout: 40_000 });

export async function unlock(page: Page, password: string) {
  await page.locator("#lock-pw").fill(password);
  await page.getByRole("button", { name: "Unlock", exact: true }).click();
}

/** Goes to a screen without reloading the page (a reload would lock the app again). */
export async function nav(page: Page, path: string) {
  await page.evaluate((u) => { history.pushState({}, "", u); dispatchEvent(new PopStateEvent("popstate")); }, path);
}

/** nav() until `ready` shows (a navigation made while the page is still starting can be lost). */
export async function navTo(page: Page, path: string, ready: Locator) {
  for (let i = 0; i < 4; i++) {
    await nav(page, path);
    if (await ready.waitFor({ timeout: 8_000 }).then(() => true, () => false)) return;
  }
  await ready.waitFor();
}

export const uuid7 = () => {
  const t = Date.now().toString(16).padStart(12, "0");
  const r = [...crypto.getRandomValues(new Uint8Array(10))].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${t.slice(0, 8)}-${t.slice(8)}-7${r.slice(0, 3)}-${(8 + (parseInt(r[3]!, 16) & 3)).toString(16)}${r.slice(4, 7)}-${r.slice(7, 19)}`;
};
export const daysAgo = (n: number) => {
  const d = new Date(Date.now() - n * 864e5);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Writes a dream on a date through the editor. `pick` chooses which suggested chips to confirm (by name). Returns the chips seen. */
export async function writeDream(page: Page, o: { date: string; title: string; text: string; pick?: RegExp }) {
  // right after sign-in the page can still be starting up and swallow the first navigation: try again
  const url = `/journal/write/${uuid7()}?new=1&date=${o.date}`;
  for (let i = 0; i < 4; i++) {
    await nav(page, url);
    if (await page.locator(".jtext").waitFor({ timeout: 8_000 }).then(() => true, () => false)) break;
  }
  await page.locator(".jtext").waitFor();
  await page.locator(".jtitle").fill(o.title);
  await page.locator(".jtext").click();
  await page.keyboard.type(o.text, { delay: 2 });
  const chips: string[] = [];
  if (o.pick) {
    await page.locator(".jsg .jsgo").first().waitFor({ timeout: 15_000 });
    for (const c of await page.locator(".jsg .jsgo").all()) chips.push((await c.innerText()).replace(/\s+/g, " ").trim());
    const want = page.locator(".jsg .jsgo", { hasText: o.pick }).first();
    await want.click();
  }
  // the save is debounced: wait until the page says Saved
  await expect(page.locator(".page").first()).toContainText(/Saved|Kept on this device/, { timeout: 20_000 });
  await page.getByRole("button", { name: "Done", exact: true }).first().click();
  return chips;
}
