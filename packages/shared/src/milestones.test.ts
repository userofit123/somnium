import { describe, expect, it } from "vitest";
import { dueMilestones, milestonesSeen, nightRecipe, yourPath, type MilestoneDream, type MilestoneNight, type PathDream, type PathNight } from "./milestones";

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

describe("yourPath", () => {
  const day = (i: number) => `2026-10-${String(i).padStart(2, "0")}`;
  const night = (i: number, o: Partial<PathNight> = {}): PathNight => ({ id: "n" + i, date: day(i), noRecall: false, ...o });
  const dream = (i: number, id: string, o: Partial<PathDream> = {}): PathDream => ({ id, nightId: "n" + i, date: day(i), lucid: false, lucidityLevel: 0, ...o });

  it("starts with a week of mornings as the next step, counting what is there", () => {
    const p = yourPath([night(1, { noRecall: true }), night(2)], [dream(2, "a")], [], 8);
    expect(p.reached).toEqual([]);
    expect(p.next).toMatchObject({ id: "logged-week", have: 2, need: 7 });
  });
  it("a plan-only night or a nap does not count", () => {
    const p = yourPath([night(1), night(2, { nap: true }), night(3, { noRecall: true })], [dream(2, "a")], [], 8);
    expect(p.next).toMatchObject({ id: "logged-week", have: 1 });
  });
  it("finds the day a run of 7 recalled nights was reached, after a broken run", () => {
    const ns = [1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12].map((i) => night(i));
    const ds = ns.map((n, k) => dream(Number(n.date.slice(8)), "d" + k));
    const p = yourPath(ns, ds, [{ lessonId: "recall", doneOn: day(4) }], 8);
    expect(p.reached.map((s) => [s.id, s.on])).toEqual([["first-lesson", day(4)], ["logged-week", day(8)], ["recall-week", day(11)]]);
    expect(p.next?.id).toBe("two-dreams");
  });
  it("lucid steps in date order; the nightmare step shows once reached but is never the next one", () => {
    const ns = Array.from({ length: 12 }, (_, k) => night(k + 1));
    const ds = [
      ...ns.map((_, k) => dream(k + 1, "r" + k)),
      dream(2, "x"),
      dream(9, "l1", { lucid: true, lucidityLevel: 1, becameLucidHow: "spontaneous" }),
      dream(10, "l2", { lucid: true, lucidityLevel: 3, becameLucidHow: "dream_sign", nightmare: true }),
    ];
    const p = yourPath(ns, ds, [], 0);
    const ids = p.reached.map((s) => s.id);
    expect(ids).toEqual(["two-dreams", "logged-week", "recall-week", "first-lucid", "first-technique", "first-clear", "first-sign", "nightmare-lucid"]);
    expect(p.reached.find((s) => s.id === "first-clear")?.on).toBe(day(10));
    expect(p.next).toMatchObject({ id: "first-lesson" });
  });
  it("counts lucid dreams toward 5, and says 'logged here' for someone who had them before", () => {
    const ns = [1, 2, 3].map((i) => night(i));
    const ds = [dream(1, "a", { lucid: true }), dream(2, "b", { lucid: true }), dream(3, "c", { lucid: true })];
    const p = yourPath(ns, ds, [1, 2].map((i) => ({ lessonId: "l" + i, doneOn: day(i) })), 2, "some");
    expect(p.reached.find((s) => s.id === "first-lucid")?.title).toBe("Your first lucid dream logged here");
    expect(p.reached.find((s) => s.id === "course-done")?.on).toBe(day(2));
    expect(yourPath(ns, ds, [], 0).next?.id).toBe("logged-week");
    const later = yourPath(Array.from({ length: 8 }, (_, k) => night(k + 1)), [...ds, ...Array.from({ length: 8 }, (_, k) => dream(k + 1, "z" + k)), dream(2, "y")], [{ lessonId: "l", doneOn: day(1) }], 0);
    expect(later.next).toMatchObject({ id: "first-technique" });
  });
});
