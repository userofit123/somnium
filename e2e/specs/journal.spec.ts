import { test, expect, daysAgo, writeDream, nav } from "../fixtures";
import { sql, userId } from "../db";

const TITLE = "Zebra school dream";
const TEXT = "I was back at my old school and my grandmother was in the hallway. The clock kept changing, I realized I was dreaming and started flying over the playground.";

test("write a dream, confirm a suggestion, find it by search, the server holds only envelopes", async ({ app }) => {
  const { page, acct } = app;
  const chips = await writeDream(page, { date: daysAgo(1), title: TITLE, text: TEXT, pick: /./ });
  expect(chips.length, "the text should trigger at least one detection suggestion").toBeGreaterThan(0);

  // the confirmed suggestion is now an element of the dream (its chip is a link in the saved dream, not a suggestion)
  await nav(page, "/journal");
  await page.getByPlaceholder("Search your dreams").fill("grandmother");
  await expect(page.locator("#app")).toContainText(TITLE);
  await page.getByPlaceholder("Search your dreams").fill("nothing-like-this-qqq");
  await expect(page.locator("#app")).not.toContainText(TITLE);

  // the server: wait for the sync, then read the rows as the database owner
  const uid = userId(acct.username)!;
  await expect.poll(() => sql(`SELECT count(*) FROM dreams WHERE user_id = '${uid}'`)[0]![0], { timeout: 30_000 }).toBe("1");
  const [title, text] = sql(`SELECT title, text FROM dreams WHERE user_id = '${uid}'`)[0]!;
  for (const v of [title, text]) {
    expect(v).not.toMatch(/Zebra|grandmother|school|playground/i);
    expect(v!.length).toBeGreaterThan(20);
  }
  const els = sql(`SELECT name FROM elements WHERE user_id = '${uid}'`);
  expect(els.length).toBeGreaterThan(0);
  for (const [n] of els) expect(n).not.toMatch(/grandmother|school|clock|flying|playground/i);
  // nothing readable anywhere in the user's dream rows
  const dump = sql(`SELECT row_to_json(d)::text FROM dreams d WHERE user_id = '${uid}'`).flat().join(" ");
  expect(dump).not.toMatch(/grandmother|playground|Zebra/i);
});
