import { describe, expect, it } from "vitest";
import { CORE_HABIT_IDS, DSA_ANCHORS, allDoneStreak, habitStreak, pmDay, pmWeek, pmSetId, pmHitId, pmMissId } from "./habits";

const t = (date: string, item: string, done = true) => ({ date, item, done });
describe("streaks", () => {
  const ticks = [t("2026-11-05", "habit:journal"), t("2026-11-06", "habit:journal"), t("2026-11-04", "habit:journal")];
  it("counts back from yesterday when today is not done yet", () => expect(habitStreak(ticks, "habit:journal", "2026-11-07")).toBe(3));
  it("includes today when done", () => expect(habitStreak([...ticks, t("2026-11-07", "habit:journal")], "habit:journal", "2026-11-07")).toBe(4));
  it("breaks on a gap and ignores undone rows", () => {
    expect(habitStreak([t("2026-11-04", "habit:journal"), t("2026-11-06", "habit:journal")], "habit:journal", "2026-11-07")).toBe(1);
    expect(habitStreak([t("2026-11-06", "habit:journal", false)], "habit:journal", "2026-11-07")).toBe(0);
  });
  it("all-done needs every core habit on the day", () => {
    const day = (d: string, n: number) => CORE_HABIT_IDS.slice(0, n).map((i) => t(d, i));
    expect(allDoneStreak([...day("2026-11-06", 4), ...day("2026-11-05", 4), ...day("2026-11-04", 3)], "2026-11-07")).toBe(2);
    expect(allDoneStreak([...day("2026-11-07", 4), ...day("2026-11-06", 4)], "2026-11-07")).toBe(2);
    expect(allDoneStreak([], "2026-11-07")).toBe(0);
  });
});
describe("prospective memory", () => {
  const set = (d: string, ...ids: string[]) => ids.map((i, k) => ({ ...t(d, pmSetId(i)), createdAt: `${d}T0${k}:00` }));
  it("reads a day's targets and their state", () => {
    const rows = [...set("2026-11-07", "door", "pet", "light"), t("2026-11-07", pmHitId("pet")), t("2026-11-07", pmMissId("light"))];
    expect(pmDay(rows, "2026-11-07").targets).toEqual([{ id: "door", state: "open" }, { id: "pet", state: "hit" }, { id: "light", state: "miss" }]);
  });
  it("week: earlier unlogged targets are misses, today's are left out", () => {
    const rows = [...set("2026-11-06", "door", "pet"), t("2026-11-06", pmHitId("door")), ...set("2026-11-07", "light", "flower"), t("2026-11-07", pmHitId("light"))];
    expect(pmWeek(rows, "2026-11-07")).toEqual({ days: 2, set: 4, hit: 2, miss: 1, rate: 2 / 3 });
    expect(pmWeek([], "2026-11-07").rate).toBeNull();
  });
  it("ignores days older than a week", () => expect(pmWeek(set("2026-10-20", "door"), "2026-11-07").set).toBe(0));
});
describe("Dreamsign Awareness Scale", () => {
  it("has the five course anchors", () => { expect(DSA_ANCHORS).toHaveLength(5); expect(DSA_ANCHORS[3]).toBe("Lucid: you noticed it was odd and realised therefore that you were dreaming."); });
});
