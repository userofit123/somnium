import { test, expect, daysAgo, writeDream, nav } from "../fixtures";

// Four dreams on four nights share one odd element ("I flew": a LaBerge action sign, shown as Did the impossible); it is confirmed in each,
// so it turns up in 4 dreams within a month and the Signs shortlist lists it.
test("four dreams sharing a sign-ish element show it in the Signs shortlist", async ({ app }) => {
  const { page } = app;
  for (let i = 1; i <= 4; i++) {
    const chips = await writeDream(page, { date: daysAgo(i), title: `Signs dream ${i}`, text: `Dream number ${i}. I flew over the town and my teacher was walking beside the river.`, pick: /Did the impossible/ });
    expect(chips.join("|")).toMatch(/Did the impossible/);
  }
  await nav(page, "/signs");
  const row = page.locator(".sgshort .sgrow", { hasText: /Did the impossible/ });
  await expect(row).toBeVisible({ timeout: 20_000 });
  await expect(row).toContainText(/4 (dreams|of)|4 /);
  await expect(page.locator(".sgshort")).not.toContainText("No dream signs yet");
});
