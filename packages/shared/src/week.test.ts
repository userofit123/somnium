import { describe, expect, it } from "vitest";
import { isReviewTime, reviewWeekday, weekSummary, type WeekInput } from "./week";
import type { Clock } from "./insights";

// days and minutes straight from the ISO text, so the test doesn't depend on the machine's time zone
const clock: Clock = { day: (iso) => iso.slice(0, 10), minutes: (iso) => Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16)) };
const el = (id: string, name: string, sign = false) => ({ id, name, kind: "object" as const, aliases: null, isDreamSign: sign, signCategory: null, confirmed: true });
const check = (at: string) => ({ at, kind: "text" as const, outcome: "awake" as const, prompted: false });
// Sunday 2026-11-15 ends the week Monday 9 to Sunday 15; last week is 2 to 8
const base: WeekInput = {
  nights: [
    { id: "n1", date: "2026-11-10", dreamCount: 2, lucidCount: 1, techniquesDone: ["mild", "wbtb"] },
    { id: "n2", date: "2026-11-11", dreamCount: 1, lucidCount: 0, techniquesDone: ["mild"] },
    { id: "n3", date: "2026-11-12", dreamCount: 0, noRecall: true },
    { id: "n4", date: "2026-11-14", dreamCount: 1, lucidCount: 0, techniquesDone: ["ssild"] },
    { id: "n5", date: "2026-11-15", dreamCount: 1, lucidCount: 0 },
    { id: "p1", date: "2026-11-03", dreamCount: 1, lucidCount: 0 },
    { id: "p2", date: "2026-11-04", dreamCount: 0, noRecall: true },
  ],
  dreams: [
    { id: "d1", date: "2026-11-10", lucid: true }, { id: "d2", date: "2026-11-10", lucid: false },
    { id: "d3", date: "2026-11-11", lucid: false }, { id: "d4", date: "2026-11-14", lucid: false }, { id: "d5", date: "2026-11-15", lucid: false },
    { id: "d6", date: "2026-11-03", lucid: false },
  ],
  elements: [el("e1", "School", true), el("e2", "Cat"), el("e3", "Teeth", true)],
  links: [
    { dreamId: "d1", elementId: "e1", source: "manual" as const }, { dreamId: "d3", elementId: "e1", source: "manual" as const },
    { dreamId: "d4", elementId: "e3", source: "manual" as const }, { dreamId: "d2", elementId: "e2", source: "manual" as const },
    { dreamId: "d6", elementId: "e3", source: "manual" as const },
  ],
  checks: [check("2026-11-09T10:00:00Z"), check("2026-11-12T10:00:00Z"), check("2026-11-15T10:00:00Z"), check("2026-11-05T10:00:00Z")],
};

describe("weekSummary", () => {
  const w = weekSummary(base, "2026-11-15", clock);
  it("sums this week against last week", () => {
    expect(w.now).toMatchObject({ from: "2026-11-09", to: "2026-11-15", nights: 5, dreams: 5, recall: 1, lucid: 1, lucidNights: 1, checks: 3 });
    expect(w.now.checksPerDay).toBe(0.4);
    expect(w.last).toMatchObject({ from: "2026-11-02", to: "2026-11-08", nights: 2, dreams: 1, recall: 0.5, lucid: 0, checks: 1 });
  });
  it("leaves a lucid nap out of the lucid nights, like the night counts", () => {
    const withNap = { ...base, nights: [...base.nights, { id: "nap1", date: "2026-11-13", dreamCount: 1, lucidCount: 1, nap: true }] };
    expect(weekSummary(withNap, "2026-11-15", clock).now).toMatchObject({ nights: 5, lucidNights: 1 });
  });
  it("puts the techniques of lucid nights first", () => {
    expect(w.techniques.map((t) => [t.id, t.nights, t.lucidNights])).toEqual([["mild", 2, 1], ["wbtb", 1, 1], ["ssild", 1, 0]]);
  });
  it("names the sign in most of this week's dreams, with its id", () => {
    expect(w.topSign).toEqual({ id: "e1", name: "School", dreams: 2 });
  });
  it("writes 2-3 observations, citing the claims", () => {
    expect(w.notes.length).toBeGreaterThanOrEqual(2);
    expect(w.notes.length).toBeLessThanOrEqual(3);
    expect(w.notes[0]!.text).toMatch(/1 dream a night over 5 logged nights, up from 0.5 last week/);
    expect(w.notes[1]!.text).toMatch(/Lucid on 1 of 5 nights, with MILD/);
    expect(w.notes[2]!.sources).toEqual(["C1"]);
    for (const n of w.notes) for (const id of n.sources) expect(n.text).toContain(`[${id}]`);
  });
  it("recommends one thing, with sources", () => {
    expect(w.tip.text).toMatch(/^Keep MILD next week/);
    expect(w.tip.sources).toEqual(["D5"]);
  });
  it("asks for a daily journal on a thin week, and copes with an empty one", () => {
    const e = weekSummary({ nights: [], dreams: [], elements: [], links: [], checks: [] }, "2026-11-15", clock);
    expect(e.now.recall).toBeNull();
    expect(e.topSign).toBeNull();
    expect(e.tip.sources).toEqual(["C2"]);
    expect(e.notes[0]!.text).toMatch(/No nights logged/);
  });
});

describe("review time", () => {
  it("is the evening before the week starts", () => {
    expect(reviewWeekday(1)).toBe(0);
    expect(reviewWeekday(0)).toBe(6);
    expect(isReviewTime("2026-11-15", 18, 1)).toBe(true);
    expect(isReviewTime("2026-11-15", 16, 1)).toBe(false);
    expect(isReviewTime("2026-11-14", 18, 1)).toBe(false);
    expect(isReviewTime("2026-11-14", 18, 0)).toBe(true);
  });
});
