import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { planDay, rcSchedule, wakingWindow, checkKindOf, reminderText, DEFAULT_RC_SCHEDULE, type RealityCheckSchedule } from "./reminders";

// the plans are wall-clock times in the device's zone: pin one with DST (Node picks up a changed TZ at once)
const oldTz = process.env.TZ;
beforeAll(() => { process.env.TZ = "Europe/Berlin"; });
afterAll(() => { process.env.TZ = oldTz; });

const S = (o: Partial<RealityCheckSchedule> = {}): RealityCheckSchedule => ({ ...DEFAULT_RC_SCHEDULE, useSleep: false, from: "08:00", to: "22:00", seed: 42, ...o });
const hm = (t: number) => { const d = new Date(t); return d.getHours() * 60 + d.getMinutes(); };
const gaps = (ts: number[]) => ts.slice(1).map((t, i) => (t - ts[i]!) / 60_000);

describe("planDay", () => {
  it("spreads the default 8 over the waking window, sorted, on whole minutes", () => {
    const p = planDay(S(), "2026-06-10");
    expect(p).toHaveLength(8);
    for (const x of p) { expect(hm(x.at)).toBeGreaterThanOrEqual(8 * 60); expect(hm(x.at)).toBeLessThanOrEqual(22 * 60); expect(x.at % 60_000).toBe(0); }
    expect([...p].sort((a, b) => a.at - b.at)).toEqual(p);
    expect(new Date(p[0]!.at).getDate()).toBe(10);
  });

  it("keeps the minimum gap, and gives fewer when the window can't hold them all", () => {
    for (const seed of [1, 2, 3, 99, 12345]) {
      const p = planDay(S({ perDay: 20, minGap: 30, seed }), "2026-06-10");
      expect(Math.min(...gaps(p.map((x) => x.at)))).toBeGreaterThanOrEqual(30);
    }
    // 2 hours, 60 minute gap: at most 3 fit (start, middle, end)
    const tight = planDay(S({ from: "10:00", to: "12:00", perDay: 10, minGap: 60 }), "2026-06-10");
    expect(tight.length).toBeLessThanOrEqual(3);
    expect(Math.min(...gaps(tight.map((x) => x.at)))).toBeGreaterThanOrEqual(60);
  });

  it("allows 1 to 20 a day", () => {
    expect(rcSchedule({ perDay: 0 }).perDay).toBe(1);
    expect(rcSchedule({ perDay: 50 }).perDay).toBe(20);
    expect(planDay(S({ perDay: 1 }), "2026-06-10")).toHaveLength(1);
    expect(planDay(S({ perDay: 20, minGap: 30 }), "2026-06-10")).toHaveLength(20);
  });

  it("skips quiet hours, also when they cross midnight", () => {
    const p = planDay(S({ perDay: 12, quiet: { on: true, from: "12:00", to: "14:00" } }), "2026-06-10");
    expect(p.length).toBe(12);
    for (const x of p) expect(hm(x.at) >= 12 * 60 && hm(x.at) < 14 * 60).toBe(false);
    const night = planDay(S({ from: "18:00", to: "03:00", perDay: 10, minGap: 20, quiet: { on: true, from: "23:30", to: "01:00" } }), "2026-06-10");
    for (const x of night) expect(hm(x.at) >= 23 * 60 + 30 || hm(x.at) < 60).toBe(false);
  });

  it("handles a waking window that crosses midnight", () => {
    const p = planDay(S({ from: "20:00", to: "04:00", perDay: 8 }), "2026-06-10");
    expect(p).toHaveLength(8);
    const start = new Date(2026, 5, 10, 20).getTime(), end = new Date(2026, 5, 11, 4).getTime();
    for (const x of p) { expect(x.at).toBeGreaterThanOrEqual(start); expect(x.at).toBeLessThanOrEqual(end); }
    expect(p.some((x) => new Date(x.at).getDate() === 11)).toBe(true);
  });

  it("is DST-safe: the gap holds in real time across the spring and autumn changes", () => {
    // Berlin: 2026-03-29 02:00 -> 03:00, 2026-10-25 03:00 -> 02:00. A night window covers both jumps.
    for (const date of ["2026-03-28", "2026-10-24"]) {
      const p = planDay(S({ from: "22:00", to: "06:00", perDay: 14, minGap: 30 }), date);
      expect(p).toHaveLength(14);
      expect(Math.min(...gaps(p.map((x) => x.at)))).toBeGreaterThanOrEqual(30);
      const start = new Date(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8), 22).getTime();
      for (const x of p) { expect(x.at).toBeGreaterThanOrEqual(start); expect(x.at - start).toBeLessThanOrEqual(9 * 3_600_000); }
    }
    // the day itself: 23 hours long, all 8 still inside 08:00-22:00
    const spring = planDay(S(), "2026-03-29");
    expect(spring).toHaveLength(8);
    for (const x of spring) expect(hm(x.at)).toBeGreaterThanOrEqual(8 * 60);
  });

  it("is the same for the same date and seed, and differs by date and by seed", () => {
    const a = planDay(S(), "2026-06-10"), b = planDay(S(), "2026-06-10");
    expect(a).toEqual(b);
    expect(planDay(S(), "2026-06-11").map((x) => hm(x.at))).not.toEqual(a.map((x) => hm(x.at)));
    expect(planDay(S(), "2026-06-10", 7).map((x) => x.at)).not.toEqual(a.map((x) => x.at));
  });

  it("includes habit moments at their own times, keeps random ones a gap away, and skips those in quiet hours", () => {
    const s = S({ habits: [{ at: "13:00", label: "After a meal" }, { at: "15:00", label: "Walking through a door" }], quiet: { on: true, from: "14:30", to: "15:30" } });
    const p = planDay(s, "2026-06-10");
    const h = p.filter((x) => x.habit);
    expect(h).toHaveLength(1);
    expect(hm(h[0]!.at)).toBe(13 * 60);
    expect(h[0]!.habit).toBe("After a meal");
    expect(p.filter((x) => !x.habit)).toHaveLength(8);
    expect(Math.min(...gaps(p.map((x) => x.at)))).toBeGreaterThanOrEqual(30);
    // a habit after midnight in a window that crosses it lands on the next date
    const late = planDay(S({ from: "20:00", to: "03:00", habits: [{ at: "01:00", label: "Checking your phone" }] }), "2026-06-10").find((x) => x.habit)!;
    expect(new Date(late.at).getDate()).toBe(11);
  });

  it("honours pause for today, only today", () => {
    expect(planDay(S({ pausedOn: "2026-06-10", habits: [{ at: "13:00", label: "After a meal" }] }), "2026-06-10")).toEqual([]);
    expect(planDay(S({ pausedOn: "2026-06-10" }), "2026-06-11")).toHaveLength(8);
  });

  it("rotates the chosen checks", () => {
    const p = planDay(S({ checks: ["nose-pinch", "re-read-text"] }), "2026-06-10");
    for (let i = 1; i < p.length; i++) expect(p[i]!.check).not.toBe(p[i - 1]!.check);
  });
});

describe("waking window, kinds and text", () => {
  it("uses wake + 1 h to bedtime - 1 h from the Sleep settings", () => {
    expect(wakingWindow(S({ useSleep: true }), { wake: "06:30", bedtime: "23:00" })).toEqual({ from: "07:30", to: "22:00" });
    expect(wakingWindow(S({ useSleep: true }), { wake: "07:00", bedtime: "00:30" })).toEqual({ from: "08:00", to: "23:30" });
    expect(wakingWindow(S({ useSleep: false, from: "09:00", to: "21:00" }))).toEqual({ from: "09:00", to: "21:00" });
  });
  it("cleans a stored schedule", () => {
    const s = rcSchedule({ perDay: "x", from: "25:00", habits: [{ at: "12:00", label: "My secret place" }, { at: "12:00", label: "After a meal" }], checks: [], showSign: "yes" });
    expect(s.perDay).toBe(8);
    expect(s.from).toBe("08:00");
    expect(s.habits).toEqual([{ at: "12:00", label: "After a meal" }]);
    expect(s.checks).toEqual(["nose-pinch", "re-read-text"]);
    expect(s.showSign).toBe(false);
  });
  it("maps checks to the table's kinds", () => {
    expect(checkKindOf("nose-pinch")).toBe("nose");
    expect(checkKindOf("re-read-text")).toBe("text");
    expect(checkKindOf("mirror")).toBe("other");
  });
  it("is generic unless a sign is given", () => {
    const c = { name: "Nose pinch", howTo: "Pinch your nose and try to breathe in." };
    expect(reminderText(c)).toEqual({ title: "Are you dreaming? Really check.", body: "Nose pinch: Pinch your nose and try to breathe in." });
    expect(reminderText(c, { sign: "Flying" }).body).toContain("Flying");
  });
});
