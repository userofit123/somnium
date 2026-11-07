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

import { catDay, catSchedule, cueSchedule, cueWindow, trainingPairings, wbtbModePlan, WBTB_MODE_DEFS, CUE_START_GAIN, CUE_VOLUMES } from "./guided";
describe("WBTB modes", () => {
  const bed = bedtimeAt("2026-11-08", "23:00");
  it("short: alarm at 5 h, 10 min up (Aspy)", () => {
    const p = wbtbModePlan(bed, "short");
    expect([p.alarm.wake, p.alarm.sleepMin, p.alarm.timing, p.backAt.getHours(), p.backAt.getMinutes(), p.napEnd]).toEqual(["04:00", 300, "ok", 4, 10, null]);
  });
  it("long: alarm at 6 h, 60 min up (Erlacher and Stumbrys)", () => {
    const p = wbtbModePlan(bed, "long");
    expect([p.alarm.wake, p.backAt.getHours(), p.backAt.getMinutes()]).toEqual(["05:00", 6, 0]);
  });
  it("nap: alarm at 6 h, 60 min up, then a 90-minute nap (LaBerge 1994)", () => {
    const p = wbtbModePlan(bed, "nap");
    expect([p.alarm.wake, p.backAt.getHours(), p.napEnd!.getHours(), p.napEnd!.getMinutes()]).toEqual(["05:00", 6, 7, 30]);
    expect(WBTB_MODE_DEFS.nap.napMin).toBe(90);
  });
  it("still warns when a mode's alarm is moved to 4.5 h or less", () => {
    expect(wbtbModePlan(bed, "long", { sleepMin: 270 }).alarm.timing).toBe("too-early");
    expect(wbtbModePlan(bed, "short", { awakeMin: 5 }).backAt.getMinutes()).toBe(5);
  });
});

describe("CAT", () => {
  it("wakes 90 min early for 7 days, then alternates A (normal) and B (early)", () => {
    const s = catSchedule("2026-11-09", "07:00", 11);
    expect(s.map((d) => [d.day, d.stage, d.letter, d.alarm])).toEqual([
      [1, 1, null, "05:30"], [2, 1, null, "05:30"], [3, 1, null, "05:30"], [4, 1, null, "05:30"], [5, 1, null, "05:30"], [6, 1, null, "05:30"], [7, 1, null, "05:30"],
      [8, 2, "A", "07:00"], [9, 2, "B", "05:30"], [10, 2, "A", "07:00"], [11, 2, "B", "05:30"],
    ]);
  });
  it("crosses month ends and refuses dates before the start", () => {
    expect(catDay("2026-11-28", "2026-12-05", "06:00")!.day).toBe(8);
    expect(catDay("2026-11-28", "2026-11-27", "06:00")).toBeNull();
    expect(catDay("2026-11-28", "2026-11-28", "01:00")!.alarm).toBe("23:30");
  });
});

describe("sound cue", () => {
  it("cues from 6 h after training until the wake time at night (Konkoly 2024)", () => {
    const w = cueWindow("night", { now: 0, trainedAt: 0, wakeAt: 8 * 3_600_000 });
    expect([w.start, w.end]).toEqual([6 * 3_600_000, 8 * 3_600_000]);
  });
  it("nap and WBTB: after the settle time, for a 90-minute nap", () => {
    const w = cueWindow("nap", { now: 1000, settleMin: 20 });
    expect([w.start - 1000, w.end - w.start]).toEqual([20 * 60_000, 90 * 60_000]);
  });
  it("every 30 s, starting at a whisper and rising to the chosen volume", () => {
    const s = cueSchedule(0, 10 * 60_000, 30, CUE_VOLUMES.soft);
    expect(s.length).toBe(20);
    expect(s[0]).toEqual({ at: 0, gain: CUE_START_GAIN });
    expect(s[1]!.at).toBe(30_000);
    expect(s[9]!.gain).toBe(CUE_VOLUMES.soft);
    expect(s.every((c, i) => i === 0 || c.gain >= s[i - 1]!.gain)).toBe(true);
  });
  it("training: 20 pairings over 20 minutes (Carr 2023's 20-minute session)", () => expect(trainingPairings()).toBe(20));
});
