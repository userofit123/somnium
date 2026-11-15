import { describe, expect, it } from "vitest";
import { dueMilestones, milestonesSeen, nightRecipe, type MilestoneDream, type MilestoneNight } from "./milestones";

const d = (id: string, o: Partial<MilestoneDream> = {}): MilestoneDream => ({ id, nightId: "n0", lucid: false, lucidityLevel: 0, ...o });
const nights: MilestoneNight[] = [{ id: "n0" }, { id: "n1", techniquesDone: ["mild"], wbtbUsed: true }];

describe("dueMilestones", () => {
  it("a first lucid dream, from a plan and clear, is all three at once, the biggest first", () => {
    expect(dueMilestones(d("x", { lucid: true, lucidityLevel: 3, nightId: "n1" }), [d("a"), d("b")], nights, {})).toEqual(["first-lucid", "first-technique", "first-clear"]);
  });
  it("only what no other dream reached and was not seen before", () => {
    const now = d("x", { lucid: true, lucidityLevel: 4, nightId: "n1" });
    expect(dueMilestones(now, [d("a", { lucid: true, lucidityLevel: 1 })], nights, {})).toEqual(["first-technique", "first-clear"]);
    expect(dueMilestones(now, [d("a", { lucid: true, lucidityLevel: 1 })], nights, { "first-technique": { on: "2026-11-01", dreamId: "a" } })).toEqual(["first-clear"]);
    expect(dueMilestones(now, [d("a", { lucid: true, lucidityLevel: 3, becameLucidHow: "reality_check" })], nights, {})).toEqual([]);
  });
  it("the dream itself in the list (an older copy of it) does not count against it", () => {
    expect(dueMilestones(d("x", { lucid: true }), [d("x", { lucid: true })], nights, {})).toEqual(["first-lucid"]);
  });
  it("not lucid is nothing; a trained way of becoming lucid counts as from a technique", () => {
    expect(dueMilestones(d("x", { lucidityLevel: 0 }), [], nights, {})).toEqual([]);
    expect(dueMilestones(d("x", { lucid: true, lucidityLevel: 1, becameLucidHow: "wild" }), [], nights, {})).toEqual(["first-lucid", "first-technique"]);
    expect(dueMilestones(d("x", { lucid: true, lucidityLevel: 1, becameLucidHow: "spontaneous" }), [], nights, {})).toEqual(["first-lucid"]);
  });
  it("someone with lucid dreams before the journal gets no 'first lucid dream'", () => {
    expect(dueMilestones(d("x", { lucid: true, lucidityLevel: 1, nightId: "n1" }), [], nights, {}, "some")).toEqual(["first-technique"]);
    expect(dueMilestones(d("x", { lucid: true, lucidityLevel: 1 }), [], nights, {}, "regular")).toEqual([]);
    expect(dueMilestones(d("x", { lucid: true, lucidityLevel: 1 }), [], nights, {}, "new")).toEqual(["first-lucid"]);
  });
});

describe("nightRecipe and milestonesSeen", () => {
  it("names the night's techniques, WBTB once", () => {
    expect(nightRecipe(nights[1])).toEqual(["MILD", "WBTB"]);
    expect(nightRecipe({ id: "n", techniquesDone: ["wbtb"], wbtbUsed: true })).toEqual(["WBTB"]);
    expect(nightRecipe(undefined)).toEqual([]);
  });
  it("records each id with the day and the dream", () => {
    expect(milestonesSeen(["first-lucid", "first-clear"], "x", "2026-11-15")).toEqual({ "first-lucid": { on: "2026-11-15", dreamId: "x" }, "first-clear": { on: "2026-11-15", dreamId: "x" } });
  });
});
