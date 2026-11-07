import { describe, expect, it } from "vitest";
import { goalProgress, periodDaysLeft } from "./goals";

const night = (date: string, dreamCount: number, lucidCount = 0) => ({ date, dreamCount, lucidCount, noRecall: dreamCount === 0 });
const data = { today: "2026-03-12", checkDays: ["2026-03-12", "2026-03-12", "2026-03-11"], nights: [night("2026-03-09", 1), night("2026-03-10", 0), night("2026-03-11", 2, 1), night("2026-03-12", 1), night("2026-03-02", 1, 2)] };

describe("goalProgress", () => {
  it("recall nights this week (Monday on)", () => {
    const p = goalProgress({ kind: "recall_per_week", target: 5 }, data);
    expect(p).toMatchObject({ value: 3, done: false, line: "3 of 5 nights this week" });
  });
  it("lucid dreams this month", () => expect(goalProgress({ kind: "lucid_per_month", target: 3 }, data)).toMatchObject({ value: 3, done: true, ratio: 1 }));
  it("reality checks today", () => expect(goalProgress({ kind: "checks_per_day", target: 4 }, data)).toMatchObject({ value: 2, ratio: 0.5 }));
  it("journal streak", () => expect(goalProgress({ kind: "journal_streak", target: 7 }, data).value).toBe(4));
  it("days left", () => { expect(periodDaysLeft("recall_per_week", "2026-03-12")).toBe(3); expect(periodDaysLeft("lucid_per_month", "2026-03-12")).toBe(19); expect(periodDaysLeft("checks_per_day", "2026-03-12")).toBeNull(); });
});
