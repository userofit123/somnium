import { describe, expect, it } from "vitest";
import { eveningWeekday, freeNightsOf, reasonParts, suggestTonight, wbtbBlock, wbtbNightsOf, type TonightInput } from "./tonight";

// 2026-11-14 is a Saturday morning: the night began on Friday evening (5)
const base: TonightInput = { lesson: "mild-wbtb", date: "2026-11-14", freeNights: [5, 6], sleepFirst: false, safetyChecked: true, wbtbNights: [] };

describe("tonight's suggested plan", () => {
  it("files a night under the weekday of its evening", () => {
    expect(eveningWeekday("2026-11-14")).toBe(5);
    expect(eveningWeekday("2026-11-16")).toBe(0);
  });

  it("builds recall in lessons 1-2 and adds dream sign rehearsal in lesson 3, with no WBTB", () => {
    for (const lesson of ["recall", "journal-habits"]) {
      const s = suggestTonight({ ...base, lesson });
      expect(s.techniques).toEqual(["journaling"]);
      expect(s.wbtb).toBe(false);
      expect(s.intention).toMatch(/remember my dreams/);
    }
    const s = suggestTonight({ ...base, lesson: "reality-checks" });
    expect(s.techniques).toEqual(["dream-signs"]);
    expect(s.wbtb).toBe(false);
    expect(s.alt).toBeNull();
  });

  it("suggests WBTB + MILD on a free night from lesson 4, MILD at bedtime on other nights", () => {
    const free = suggestTonight(base);
    expect(free.techniques).toEqual(["mild", "wbtb"]);
    expect(free.wbtb).toBe(true);
    expect(free.reason).toMatch(/\[B37\]/);
    const work = suggestTonight({ ...base, date: "2026-11-17" }); // Monday evening
    expect(work.techniques).toEqual(["mild"]);
    expect(work.noWbtb).toMatch(/sleep in/);
  });

  it("offers SSILD as the alternative from the SSILD lesson on, and once the course is done", () => {
    expect(suggestTonight(base).alt).toBeNull();
    expect(suggestTonight({ ...base, lesson: "ssild-wild" }).alt?.techniques).toEqual(["ssild", "wbtb"]);
    expect(suggestTonight({ ...base, lesson: null, date: "2026-11-17" }).alt?.techniques).toEqual(["ssild"]);
  });

  it("never suggests WBTB with sleep first, before the safety check or without free nights", () => {
    expect(suggestTonight({ ...base, sleepFirst: true }).wbtb).toBe(false);
    expect(suggestTonight({ ...base, safetyChecked: false }).wbtb).toBe(false);
    expect(suggestTonight({ ...base, freeNights: [] }).noWbtb).toMatch(/Choose the nights/);
  });

  it("never suggests WBTB two nights in a row or more than 3 in 7 nights", () => {
    expect(wbtbBlock({ ...base, wbtbNights: ["2026-11-13"] })).toMatch(/two in a row/);
    expect(wbtbBlock({ ...base, wbtbNights: ["2026-11-08", "2026-11-10", "2026-11-12"] })).toMatch(/3 at most/);
    // a WBTB night 7 nights back is outside the week
    expect(wbtbBlock({ ...base, wbtbNights: ["2026-11-07", "2026-11-10", "2026-11-12"] })).toBe("");
  });

  it("cleans the synced free nights", () => {
    expect(freeNightsOf([6, 5, 5, 7, -1, 2.5, "1"])).toEqual([5, 6]);
    expect(freeNightsOf(null)).toEqual([]);
  });
});

describe("wbtbNightsOf and reasonParts", () => {
  it("lists the WBTB nights, not naps and not the night itself", () => {
    const nights = [
      { date: "2026-11-10", wbtbUsed: true }, { date: "2026-11-11", techniquesPlanned: ["wbtb"] }, { date: "2026-11-12", nap: true, wbtbUsed: true },
      { date: "2026-11-13", techniquesPlanned: ["mild"] }, { date: "2026-11-14", wbtbWakeAt: "2026-11-14T03:30:00Z" },
    ];
    expect(wbtbNightsOf(nights, "2026-11-14")).toEqual(["2026-11-10", "2026-11-11"]);
  });
  it("splits a reason into plain text and its sources", () => {
    expect(reasonParts("Best-supported [B37][D11]. Costs sleep [B69][D11].")).toEqual({ text: "Best-supported. Costs sleep.", sources: ["B37", "D11", "B69"] });
  });
});
