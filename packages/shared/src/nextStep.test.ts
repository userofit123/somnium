import { describe, expect, it } from "vitest";
import { stepFor, tonightLine, type StepInput, type StepLesson } from "./nextStep";

const L = (id: string, number: number, title: string): StepLesson => ({ id, number, title });
const recall = L("recall", 1, "Remember your dreams");
const rc = L("reality-checks", 3, "Reality checks");
const mild = L("mild-wbtb", 4, "MILD + WBTB");
const ssild = L("ssild-wild", 6, "SSILD and WILD");
const last = L("troubleshooting", 8, "Troubleshooting");

const base = (o: Partial<StepInput> = {}): StepInput => ({
  hour: 10, lesson: rc, next: mild, wrote: true, ready: false,
  checks: { done: 0, target: 3 }, practice: { done: 0, total: 3 }, reviewed: false,
  tonight: { titles: [], wbtbAt: null }, ...o,
});

describe("stepFor", () => {
  it("in the morning, an unwritten night comes first, even when ready to move on", () => {
    const s = stepFor(base({ hour: 7, wrote: false, ready: true }));
    expect(s.kind).toBe("write");
    expect(s.action).toEqual({ label: "Write last night's dream", run: "write" });
    expect(s.sources.length).toBeGreaterThan(0);
  });
  it("does not ask for the dream in the evening or the small hours", () => {
    expect(stepFor(base({ hour: 20, wrote: false })).kind).not.toBe("write");
    expect(stepFor(base({ hour: 3, wrote: false })).kind).not.toBe("write");
  });
  it("offers the next lesson once the rule is met, and finishing on the last one", () => {
    const s = stepFor(base({ ready: true }));
    expect(s.kind).toBe("moveOn");
    expect(s.title).toBe("You are ready for lesson 4: MILD + WBTB");
    expect(s.action?.run).toBe("moveOn");
    expect(stepFor(base({ ready: true, lesson: last, next: null })).kind).toBe("finish");
  });
  it("in the reality checks lesson asks for at least 5 checks, with the count done", () => {
    const s = stepFor(base({ checks: { done: 2, target: 3 } }));
    expect(s.kind).toBe("checks");
    expect(s.title).toBe("Do 5 reality checks today");
    expect(s.line).toBe("2 done");
    expect(s.action?.to).toBe("/check");
    expect(stepFor(base({ checks: { done: 2, target: 8 } })).title).toBe("Do 8 reality checks today");
  });
  it("after the checks, names how many practice items are left without listing them", () => {
    const s = stepFor(base({ checks: { done: 5, target: 5 }, practice: { done: 1, total: 3 } }));
    expect(s.kind).toBe("practice");
    expect(s.title).toBe("2 practice items left in Reality checks");
    expect(s.action?.to).toBe("/train/lesson/reality-checks");
  });
  it("before lesson 3 the day's step is the practice, not the checks", () => {
    expect(stepFor(base({ lesson: recall, checks: { done: 0, target: 3 } })).kind).toBe("practice");
  });
  it("is done when everything for the day is", () => {
    expect(stepFor(base({ checks: { done: 5, target: 5 }, practice: { done: 3, total: 3 } })).kind).toBe("done");
  });
  it("in the evening of an early lesson: the review, then the intention to remember", () => {
    expect(stepFor(base({ hour: 19 })).kind).toBe("review");
    const s = stepFor(base({ hour: 22, reviewed: true }));
    expect(s.kind).toBe("tonight");
    expect(s.action).toBeNull();
  });
  it("from MILD on, the evening's step is tonight's plan: set it up, or what is planned", () => {
    const s = stepFor(base({ hour: 21, lesson: mild, next: ssild }));
    expect(s.kind).toBe("plan");
    expect(s.action).toEqual({ label: "Set it up", to: "/train/tonight" });
    const p = stepFor(base({ hour: 21, lesson: mild, next: ssild, tonight: { titles: ["MILD"], wbtbAt: "03:30" } }));
    expect(p.kind).toBe("tonight");
    expect(p.title).toBe("Tonight: WBTB at 03:30 and MILD");
    expect(p.sources).toEqual(["D11", "D12"]);
  });
  it("after the course, keeps the checks by day and the plan by night", () => {
    expect(stepFor(base({ lesson: null, next: null, checks: { done: 0, target: 4 } })).kind).toBe("checks");
    expect(stepFor(base({ lesson: null, next: null, hour: 20 })).kind).toBe("plan");
    expect(stepFor(base({ lesson: null, next: null, checks: { done: 4, target: 4 } })).kind).toBe("done");
  });
  it("every step says why and cites a source", () => {
    for (const hour of [3, 8, 13, 19]) for (const lesson of [recall, rc, mild, last, null]) {
      const s = stepFor(base({ hour, lesson, wrote: hour > 12 }));
      expect(s.why).not.toBe("");
      expect(s.sources.every((x) => /^D\d+$/.test(x))).toBe(true);
      expect(s.title + s.line + s.why).not.toMatch(/[–—]/);
    }
  });
});

describe("tonightLine", () => {
  it("joins the plan in plain words", () => {
    expect(tonightLine({ titles: [], wbtbAt: null })).toBe("");
    expect(tonightLine({ titles: ["MILD"], wbtbAt: null })).toBe("MILD");
    expect(tonightLine({ titles: ["SSILD", "MILD"], wbtbAt: "04:00" })).toBe("WBTB at 04:00, SSILD and MILD");
  });
});
