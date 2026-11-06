import { describe, expect, it } from "vitest";
import { moveOn, moveOnRules, tonightOf, currentLesson, nextLesson, COURSE_LESSONS, daysBetween, type CourseData } from "./course";

const base = (o: Partial<CourseData> = {}): CourseData => ({ today: "2026-11-06", nights: [], checkDays: [], practice: [], ...o });
const night = (date: string, dreamCount = 0, lucidCount = 0, techniquesPlanned: string[] = []) => ({ date, dreamCount, lucidCount, techniquesPlanned });

describe("recall rule", () => {
  it("counts dreams over the last 7 nights", () => {
    const r = moveOnRules.recall(base({ nights: [night("2026-11-06", 1), night("2026-11-04", 2), night("2026-10-30", 5)] }));
    expect(r).toMatchObject({ ready: false, progress: "3 of 4 dreams this week" });
    expect(r.reason).toMatch(/Recall/);
    expect(moveOnRules.recall(base({ nights: [night("2026-11-06", 2), night("2026-10-31", 2)] })).ready).toBe(true);
  });
  it("ignores a night planned for tomorrow", () => {
    expect(moveOnRules.recall(base({ nights: [night("2026-11-07", 9)] })).progress).toBe("0 of 4 dreams this week");
  });
});

describe("reality checks rule", () => {
  const days = (d: string, n: number) => Array.from({ length: n }, () => d);
  it("needs 7 days with 5 or more checks since the lesson began", () => {
    const seven = ["01", "02", "03", "04", "05", "06"].flatMap((x) => days(`2026-11-${x}`, 5));
    expect(moveOnRules["reality-checks"](base({ since: "2026-11-01", checkDays: seven })).progress).toBe("6 of 7 days with 5 or more checks");
    expect(moveOnRules["reality-checks"](base({ since: "2026-10-31", checkDays: [...seven, ...days("2026-10-31", 6)] })).ready).toBe(true);
    // a day with 4 doesn't count, nor do checks before the lesson
    expect(moveOnRules["reality-checks"](base({ since: "2026-11-01", checkDays: [...days("2026-11-02", 4), ...days("2026-10-20", 9)] })).progress).toBe("0 of 7 days with 5 or more checks");
  });
});

describe("MILD + WBTB rule", () => {
  it("is met by the first lucid dream since starting", () => {
    expect(moveOnRules["mild-wbtb"](base({ since: "2026-11-01", nights: [night("2026-10-20", 1, 1)] }))).toMatchObject({ ready: false, progress: "Day 6 of 28 · no lucid dream yet" });
    expect(moveOnRules["mild-wbtb"](base({ since: "2026-11-01", nights: [night("2026-11-03", 1, 1)] }))).toMatchObject({ ready: true, progress: "Day 6 of 28 · a lucid dream" });
  });
  it("or by 4 weeks", () => {
    const r = moveOnRules["mild-wbtb"](base({ since: "2026-10-01" }));
    expect(r.ready).toBe(true);
    expect(r.progress).toBe("Day 28 of 28 · no lucid dream yet");
    expect(moveOnRules["mild-wbtb"](base({ since: "2026-10-10" })).ready).toBe(false);
  });
});

describe("other rules", () => {
  it("journal habits wants 7 mornings in a row", () => {
    const week = ["2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"].map((d) => night(d));
    expect(moveOnRules["journal-habits"](base({ nights: week })).ready).toBe(true);
    expect(moveOnRules["journal-habits"](base({ nights: week.slice(2) })).progress).toBe("5 of 7 mornings in a row");
  });
  it("SSILD and WILD counts the nights either was planned", () => {
    const r = moveOnRules["ssild-wild"](base({ since: "2026-11-01", nights: [night("2026-11-02", 0, 0, ["ssild"]), night("2026-11-03", 0, 0, ["mild"]), night("2026-11-05", 0, 0, ["wild", "wbtb"])] }));
    expect(r).toMatchObject({ ready: false, progress: "2 of 4 nights with SSILD or WILD" });
  });
  it("SSILD and WILD doesn't count a night where either was only planned", () => {
    const plan = (date: string, o: object = {}) => ({ ...night(date, 0, 0, ["ssild"]), noRecall: false, ...o });
    const r = moveOnRules["ssild-wild"](base({ since: "2026-11-01", nights: [
      plan("2026-11-01"), // planned, nothing logged: not a try
      plan("2026-11-02", { dreamCount: 1 }), // planned and a dream written
      plan("2026-11-03", { noRecall: true }), // planned and "No recall"
      { ...night("2026-11-04"), noRecall: false, techniquesDone: ["wild"] }, // done, whatever else
    ] }));
    expect(r.progress).toBe("3 of 4 nights with SSILD or WILD");
  });
  it("troubleshooting is done once each item has been ticked", () => {
    const items = ["lesson:troubleshooting:1", "lesson:troubleshooting:2"];
    expect(moveOnRules.troubleshooting(base({ items, practice: [{ date: "2026-11-05", item: items[0]!, done: true }] })).ready).toBe(false);
    expect(moveOnRules.troubleshooting(base({ items, practice: items.map((item) => ({ date: "2026-11-05", item, done: true })) })).ready).toBe(true);
  });
  it("every lesson has a rule with a progress line and a reason", () => {
    for (const l of COURSE_LESSONS) {
      const r = moveOn(l, base({ items: ["x"] }))!;
      expect(r.progress, l).not.toBe("");
      expect(r.reason, l).not.toBe("");
      expect(r.share).toBeGreaterThanOrEqual(0);
      expect(r.share).toBeLessThanOrEqual(1);
      expect(r.progress + r.reason, l).not.toMatch(/[–—]/);
    }
    expect(moveOn("nope", base())).toBeNull();
  });
});

describe("course helpers", () => {
  it("files tonight under the coming morning", () => {
    expect(tonightOf("2026-11-06", 21)).toBe("2026-11-07");
    expect(tonightOf("2026-11-06", 3)).toBe("2026-11-06");
    expect(tonightOf("2026-12-31", 12)).toBe("2027-01-01");
  });
  it("finds the current and next lesson", () => {
    expect(currentLesson([])).toBe("recall");
    expect(currentLesson([{ lessonId: "recall", state: "done" }])).toBe("journal-habits");
    expect(currentLesson([{ lessonId: "recall", state: "done" }, { lessonId: "mild-wbtb", state: "active" }])).toBe("mild-wbtb");
    expect(currentLesson(COURSE_LESSONS.map((lessonId) => ({ lessonId, state: "done" })))).toBeNull();
    expect(nextLesson("recall")).toBe("journal-habits");
    expect(nextLesson("troubleshooting")).toBeNull();
    expect(daysBetween("2026-10-31", "2026-11-06")).toBe(6);
  });
});
