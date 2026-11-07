import { describe, expect, it } from "vitest";
import { lagAnalysis, lagLine, mentions } from "./lag";
import type { SignDream, SignLink } from "./signs";

const dream = (id: string, date: string): SignDream => ({ id, date, lucid: false });
const link = (dreamId: string, elementId: string): SignLink => ({ dreamId, elementId, source: "manual" });
const dog = { id: "e1", name: "Dog", aliases: "puppy; hound" };

describe("mentions", () => {
  it("matches whole words, any case, aliases too", () => {
    expect(mentions("Walked the DOG in the rain", dog)).toBe(true);
    expect(mentions("A puppy at work", dog)).toBe(true);
    expect(mentions("dogma and hotdogs", dog)).toBe(false);
    expect(mentions(null, dog)).toBe(false);
  });
});

describe("lagAnalysis", () => {
  const notes = [{ date: "2026-03-01", text: "dog" }, { date: "2026-03-10", text: "the dog again" }, { date: "2026-03-20", text: "nothing" }, { date: "2026-03-25", text: "dog!" }];
  const dreams = [dream("a", "2026-03-02"), dream("b", "2026-03-16"), dream("c", "2026-03-27")];
  const links = [link("a", "e1"), link("b", "e1"), link("c", "e1")];
  it("counts the 1-2 and 5-7 day windows with a baseline", () => {
    const [row] = lagAnalysis(notes, [dog], links, dreams, "2026-04-30");
    expect(row!.days).toBe(3);
    expect(row!.residue).toMatchObject({ of: 3, hit: 2 });
    expect(row!.lag).toMatchObject({ of: 3, hit: 1 });
    expect(row!.residue.baseline).toBeCloseTo(4 / 25, 5);
    expect(row!.enough).toBe(true);
  });
  it("leaves out days whose window is not over yet", () => {
    const [row] = lagAnalysis(notes, [dog], links, dreams, "2026-03-28");
    expect(row!.lag.of).toBe(2);
  });
  it("says nothing without notes, and words the line plainly", () => {
    expect(lagAnalysis([], [dog], links, dreams, "2026-04-30")).toEqual([]);
    expect(lagLine({ of: 4, hit: 1, baseline: 0.2 }, "x")).toBe("x: 1 of 4 times (any day in the same stretch: 20%)");
    expect(lagLine({ of: 0, hit: 0, baseline: null }, "x")).toBe("x: too soon to tell");
  });
});
