import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { nightTimes, planNight, nightRow, nightSchedule, nightText, nightUrl, type ReminderRowLike } from "./reminders";

// wall-clock times in a zone with DST, as reminders.test.ts does
const oldTz = process.env.TZ;
beforeAll(() => { process.env.TZ = "Europe/Berlin"; });
afterAll(() => { process.env.TZ = oldTz; });

const hm = (t: number) => { const d = new Date(t); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
const day = (t: number) => new Date(t).getDate();
const allOn: ReminderRowLike[] = [
  { kind: "bedtime", enabled: true, schedule: { lead: 15, technique: "ssild" } },
  { kind: "wbtb", enabled: true, schedule: {} },
  { kind: "morning_journal", enabled: true, schedule: {} },
  { kind: "practice", enabled: true, schedule: { at: "18:30" } },
];
const sleep = { bedtime: "23:00", wake: "07:00" };

describe("night times from the sleep settings", () => {
  it("bedtime in the evening, wake the next morning, filed under the morning's date", () => {
    const t = nightTimes("2026-06-10", sleep);
    expect([hm(t.bedtime), day(t.bedtime), hm(t.wake), day(t.wake), t.morning]).toEqual(["23:00", 10, "07:00", 11, "2026-06-11"]);
  });
  it("a bedtime after midnight is the next date, and its reminder can fall before midnight", () => {
    const t = nightTimes("2026-06-10", { bedtime: "00:10", wake: "08:00" });
    expect([hm(t.bedtime), day(t.bedtime), hm(t.wake), day(t.wake)]).toEqual(["00:10", 11, "08:00", 11]);
    const p = planNight(allOn, "2026-06-10", { bedtime: "00:10", wake: "08:00" });
    const bed = p.find((x) => x.kind === "bedtime")!;
    expect([hm(bed.at), day(bed.at)]).toEqual(["23:55", 10]);
  });
  it("a day sleeper's night still runs bedtime to the first wake time after it", () => {
    const t = nightTimes("2026-06-10", { bedtime: "13:00", wake: "21:00" });
    expect([day(t.bedtime), hm(t.wake), day(t.wake)]).toEqual([10, "21:00", 10]);
  });
});

describe("planNight", () => {
  it("gives bedtime - lead, morning at wake and practice at its time, sorted; no WBTB unless planned", () => {
    const p = planNight(allOn, "2026-06-10", sleep);
    expect(p.map((x) => [x.kind, hm(x.at)])).toEqual([["practice", "18:30"], ["bedtime", "22:45"], ["morning_journal", "07:00"]]);
    expect(p.find((x) => x.kind === "bedtime")!.technique).toBe("ssild");
  });
  it("puts the WBTB alarm in only on a night it was planned for", () => {
    const at = new Date(2026, 5, 11, 3, 30).getTime();
    expect(planNight(allOn, "2026-06-10", sleep, at).map((x) => x.kind)).toContain("wbtb");
    expect(planNight(allOn, "2026-06-11", sleep, at).map((x) => x.kind)).not.toContain("wbtb"); // another night's
    expect(planNight(allOn, "2026-06-09", sleep, at).map((x) => x.kind)).not.toContain("wbtb");
    expect(planNight(allOn, "2026-06-10", sleep, null).map((x) => x.kind)).not.toContain("wbtb");
    const off = allOn.map((r) => (r.kind === "wbtb" ? { ...r, enabled: false } : r));
    expect(planNight(off, "2026-06-10", sleep, at).map((x) => x.kind)).not.toContain("wbtb");
  });
  it("without rows only a planned WBTB alarm rings; deleted rows count as absent", () => {
    const at = new Date(2026, 5, 11, 3, 30).getTime();
    expect(planNight([], "2026-06-10", sleep, at).map((x) => x.kind)).toEqual(["wbtb"]);
    expect(planNight(allOn.map((r) => ({ ...r, deletedAt: "2026-01-01" })), "2026-06-10", sleep).map((x) => x.kind)).toEqual([]);
  });
  it("is DST-safe: spring forward and fall back keep wall-clock wake and real-time lead", () => {
    // Europe/Berlin: 29 March 2026 02:00 → 03:00, 25 October 2026 03:00 → 02:00
    for (const ev of ["2026-03-28", "2026-10-24"]) {
      const p = planNight(allOn, ev, { bedtime: "00:30", wake: "07:00" });
      const bed = p.find((x) => x.kind === "bedtime")!, mo = p.find((x) => x.kind === "morning_journal")!;
      expect([hm(bed.at), hm(mo.at)]).toEqual(["00:15", "07:00"]);
      expect(nightTimes(ev, { bedtime: "00:30", wake: "07:00" }).bedtime - bed.at).toBe(15 * 60_000);
    }
    // the spring night is an hour shorter in real time, the autumn one an hour longer
    const len = (ev: string) => { const t = nightTimes(ev, sleep); return (t.wake - t.bedtime) / 3_600_000; };
    expect([len("2026-03-28"), len("2026-06-10"), len("2026-10-24")]).toEqual([7, 8, 9]);
    // a WBTB alarm in the skipped hour is still that night's
    expect(planNight(allOn, "2026-03-28", sleep, new Date(2026, 2, 29, 2, 30).getTime()).map((x) => x.kind)).toContain("wbtb");
  });
});

describe("rows, words and links", () => {
  it("checks stored schedules and defaults the rest", () => {
    expect(nightSchedule("bedtime", { lead: 999, technique: "nope" })).toEqual({ lead: 60, technique: "mild" });
    expect(nightSchedule("practice", { at: "25:00" })).toEqual({ at: "19:00" });
    expect(nightRow(undefined, "bedtime").on).toBe(false);
    expect(nightRow(undefined, "wbtb").on).toBe(true);
  });
  it("says nothing personal: the technique's name, never an intention", () => {
    expect(nightText({ kind: "bedtime", technique: "mild" })).toEqual({ title: "Bed in 15 minutes", body: "Tonight: MILD", lockTitle: "Bedtime" });
    expect(nightText({ kind: "morning_journal" }).title).toBe("Write your dream");
  });
  it("links each to its screen", () => {
    expect(nightUrl({ kind: "wbtb", morning: "2026-06-11" })).toBe("/train?guided=up");
    expect(nightUrl({ kind: "morning_journal", morning: "2026-06-11" })).toBe("/journal?write=1&date=2026-06-11");
    expect(nightUrl({ kind: "morning_journal", morning: "2026-06-11" }, "norecall")).toBe("/journal?norecall=2026-06-11");
  });
});
