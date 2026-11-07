import { describe, expect, it } from "vitest";
import { bedtimeAt, clockText, defaultCycles, durationText, hmToMin, minToHm, ssildAt, ssildSchedule, wbtbOption, wbtbOptions, wbtbTiming, wildPhase, WBTB_AWAKE, WBTB_AWAKE_DEFAULT, WBTB_EARLY_MIN, WBTB_TOO_EARLY_MIN } from "./guided";

describe("WBTB times", () => {
  it("files an evening bedtime on the day before the morning, an after-midnight one on the morning", () => {
    const a = bedtimeAt("2026-11-08", "23:00");
    expect([a.getFullYear(), a.getMonth(), a.getDate(), a.getHours(), a.getMinutes()]).toEqual([2026, 10, 7, 23, 0]);
    const b = bedtimeAt("2026-11-08", "00:30");
    expect([b.getDate(), b.getHours(), b.getMinutes()]).toEqual([8, 0, 30]);
  });

  it("offers 4.5, 6 and 7.5 h at 90 min cycles, crossing midnight", () => {
    const o = wbtbOptions(bedtimeAt("2026-11-08", "23:00"));
    expect(o.map((x) => [x.cycles, x.sleepMin, x.wake, x.nextDay, x.timing])).toEqual([
      [3, 270, "03:30", true, "too-early"], [4, 360, "05:00", true, "ok"], [5, 450, "06:30", true, "ok"],
    ]);
    expect(o[1]!.at.getDate()).toBe(8);
  });

  it("stays on the same day after a bedtime past midnight", () => {
    const o = wbtbOption(bedtimeAt("2026-11-08", "00:30"), 4);
    expect([o.wake, o.nextDay, o.at.getDate()]).toEqual(["06:30", false, 8]);
  });

  it("follows the cycle length", () => {
    expect(wbtbOption(bedtimeAt("2026-11-08", "22:15"), 4, 100).wake).toBe("04:55");
    expect(defaultCycles()).toBe(4);
    expect(defaultCycles(120)).toBe(3);
  });

  it("warns at 4.5 h and less as too early [D14], under 5 h as early (5-6 h recommended)", () => {
    const bed = bedtimeAt("2026-11-08", "23:00");
    expect([WBTB_TOO_EARLY_MIN, WBTB_EARLY_MIN]).toEqual([270, 300]);
    expect(wbtbOption(bed, 3, 90).timing).toBe("too-early"); // exactly 4.5 h
    expect(wbtbOption(bed, 3, 85).timing).toBe("too-early");
    expect(wbtbOption(bed, 2).timing).toBe("too-early");
    expect(wbtbOption(bed, 3, 95).timing).toBe("early"); // 4 h 45 min
    expect(wbtbOption(bed, 3, 100).timing).toBe("ok"); // 5 h
    expect([wbtbTiming(271), wbtbTiming(299), wbtbTiming(300)]).toEqual(["early", "early", "ok"]);
    expect(wbtbOptions(bed, 90, [2]).map((x) => x.cycles)).toEqual([2, 3, 4, 5]);
  });

  it("stays up 30 minutes unless chosen otherwise (30-60 recommended [B39])", () => {
    expect(WBTB_AWAKE_DEFAULT).toBe(30);
    expect(WBTB_AWAKE).toContain(WBTB_AWAKE_DEFAULT);
  });

  it("crosses a month and a year", () => {
    const o = wbtbOption(bedtimeAt("2027-01-01", "22:00"), 4);
    expect([o.at.getFullYear(), o.at.getMonth(), o.at.getDate(), o.wake, o.nextDay]).toEqual([2027, 0, 1, "04:00", true]);
  });

  it("reads and writes times", () => {
    expect(hmToMin("23:05:00")).toBe(1385);
    expect(hmToMin("25:00")).toBeNull();
    expect(hmToMin(null)).toBeNull();
    expect(minToHm(1440 + 90)).toBe("01:30");
    expect(minToHm(-30)).toBe("23:30");
    expect(durationText(270)).toBe("4 h 30 min");
    expect(durationText(360)).toBe("6 h");
    expect(durationText(10)).toBe("10 min");
  });
});

describe("SSILD schedule", () => {
  it("runs the fast cycles, then the slow ones, sight, sound, body", () => {
    const p = ssildSchedule();
    expect(p.steps).toHaveLength(24);
    expect(p.total).toBe(4 * 3 * 3 + 4 * 3 * 30);
    expect(p.steps.slice(0, 3).map((s) => s.sense)).toEqual(["sight", "sound", "body"]);
    expect(p.steps[11]).toEqual({ phase: "fast", cycle: 4, sense: "body", start: 33, end: 36 });
    expect(p.steps[12]).toEqual({ phase: "slow", cycle: 1, sense: "sight", start: 36, end: 66 });
  });

  it("takes other counts and lengths", () => {
    const p = ssildSchedule(6, 3, 2, 20);
    expect(p.total).toBe(6 * 3 * 2 + 3 * 3 * 20);
    expect(p.steps.filter((s) => s.phase === "slow")).toHaveLength(9);
  });

  it("finds the step at a moment", () => {
    const p = ssildSchedule();
    expect(ssildAt(p, 0)?.sense).toBe("sight");
    expect(ssildAt(p, 4)?.sense).toBe("sound");
    expect(ssildAt(p, 66)).toMatchObject({ phase: "slow", cycle: 1, sense: "sound" });
    expect(ssildAt(p, p.total)).toBeNull();
  });
});

describe("WILD phases", () => {
  it("relaxes first, then images, then a light focus", () => {
    const t = 15 * 60;
    expect(wildPhase(0, t)).toBe("relax");
    expect(wildPhase(179, t)).toBe("relax");
    expect(wildPhase(180, t)).toBe("images");
    expect(wildPhase(600, t)).toBe("focus");
    expect(wildPhase(t, t)).toBe("done");
    expect(wildPhase(100, 300)).toBe("relax"); // at least 2 min
  });
  it("formats a clock", () => { expect(clockText(245)).toBe("4:05"); expect(clockText(3725)).toBe("62:05"); });
});
