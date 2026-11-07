import { describe, expect, it } from "vitest";
import { periodSummary, reportPeriods, yearSummary } from "./report";

const el = (id: string, name: string, sign = false) => ({ id, name, kind: "object" as const, aliases: null, isDreamSign: sign, signCategory: null, confirmed: true });
const inp = {
  nights: [
    { id: "n1", date: "2026-03-02", dreamCount: 1, lucidCount: 1, techniquesDone: ["mild"] },
    { id: "n2", date: "2026-03-03", dreamCount: 0, noRecall: true, techniquesDone: ["mild", "wbtb"] },
    { id: "n3", date: "2026-04-01", dreamCount: 1, lucidCount: 0 },
  ],
  dreams: [
    { id: "d1", date: "2026-03-02", lucid: true, lucidityLevel: 4, title: "The flight" },
    { id: "d2", date: "2026-04-01", lucid: false, title: "Plain" },
  ],
  elements: [el("e1", "Stairs", true), el("e2", "Cat")],
  links: [{ dreamId: "d1", elementId: "e1", source: "manual" as const }, { dreamId: "d1", elementId: "e2", source: "manual" as const }, { dreamId: "d2", elementId: "e2", source: "manual" as const }],
};

describe("report", () => {
  it("summarises a month", () => {
    const s = periodSummary("2026-03", inp);
    expect(s).toMatchObject({ dreams: 1, nightsLogged: 2, nightsWithRecall: 1, recallRate: 0.5, lucid: 1 });
    expect(s.topSigns).toEqual([{ name: "Stairs", dreams: 1 }]);
    expect(s.newElementCount).toBe(2);
    expect(s.techniques).toEqual([{ id: "mild", label: "MILD", nights: 2 }, { id: "wbtb", label: "WBTB", nights: 1 }]);
    expect(s.best).toMatchObject({ date: "2026-03-02", title: "The flight" });
  });
  it("counts an element new only in the month of its first dream", () => {
    expect(periodSummary("2026-04", inp).newElementCount).toBe(0);
  });
  it("handles an empty month and builds the year", () => {
    expect(periodSummary("2025-01", inp)).toMatchObject({ dreams: 0, recallRate: null, best: null });
    const y = yearSummary("2026", inp);
    expect(y.dreams).toBe(2);
    expect(y.months).toHaveLength(12);
    expect(reportPeriods(inp.nights)).toEqual({ months: ["2026-04", "2026-03"], years: ["2026"] });
  });
});
