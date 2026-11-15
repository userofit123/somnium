import { describe, expect, it } from "vitest";
import { minutesAfterBedtime, wakeCluster, wakeFact, wakeHours, wakeStamp } from "./wakings";

// local times, so the clock hours read as written whatever the test machine's zone
const at = (d: string, hm: string) => new Date(`${d}T${hm}:00`);
const iso = (d: string, hm: string) => at(d, hm).toISOString();

describe("wakeStamp (LDJ-177)", () => {
  it("stamps a capture opened in the night's clock hours when the night has no times", () => {
    expect(wakeStamp(at("2026-11-15", "03:10"))).toBe(iso("2026-11-15", "03:10"));
    expect(wakeStamp(at("2026-11-14", "23:30"))).not.toBeNull();
    expect(wakeStamp(at("2026-11-15", "15:00"))).toBeNull();
  });
  it("goes by the night's bedtime and wake time when they are logged", () => {
    const night = { bedtime: iso("2026-11-14", "23:00"), wakeTime: iso("2026-11-15", "07:00") };
    expect(wakeStamp(at("2026-11-15", "04:00"), night)).not.toBeNull();
    expect(wakeStamp(at("2026-11-15", "07:45"), night)).not.toBeNull();
    expect(wakeStamp(at("2026-11-15", "08:30"), night)).toBeNull();
    expect(wakeStamp(at("2026-11-14", "22:00"), night)).toBeNull();
    // a bedtime alone: from bedtime on, even past the clock's night hours (a late sleeper)
    expect(wakeStamp(at("2026-11-15", "12:00"), { bedtime: iso("2026-11-15", "03:00") })).not.toBeNull();
  });
  it("never stamps a nap", () => {
    expect(wakeStamp(at("2026-11-15", "03:10"), { nap: true })).toBeNull();
  });
});

describe("the time after bedtime", () => {
  const bed = iso("2026-11-14", "23:00");
  it("counts minutes after bedtime and writes the night page's line", () => {
    expect(minutesAfterBedtime(iso("2026-11-15", "04:20"), bed)).toBe(320);
    expect(minutesAfterBedtime(iso("2026-11-14", "22:00"), bed)).toBeNull();
    expect(minutesAfterBedtime(null, bed)).toBeNull();
    expect(wakeFact(iso("2026-11-15", "04:20"), bed)).toBe("04:20 · 5 h 20 min after bedtime");
    expect(wakeFact(iso("2026-11-15", "05:00"), bed)).toBe("05:00 · 6 h after bedtime");
    expect(wakeFact(iso("2026-11-15", "04:20"), null)).toBe("04:20");
    expect(wakeFact(null, bed)).toBeNull();
  });
  it("buckets timed dreams by hour and finds where they cluster", () => {
    const rows = [["01:40", false], ["04:30", true], ["05:10", false], ["05:20", true], ["06:00", false], ["06:50", false]]
      .map(([hm, lucid]) => ({ wokeAt: iso("2026-11-15", hm as string), bedtime: bed, lucid: lucid as boolean }));
    const h = wakeHours([...rows, { wokeAt: null, bedtime: bed }]);
    expect(h).toHaveLength(8);
    expect(h[2]).toEqual({ hour: 2, dreams: 1, lucid: 0 });
    expect(h[5]).toEqual({ hour: 5, dreams: 1, lucid: 1 });
    expect(h[6]).toEqual({ hour: 6, dreams: 2, lucid: 1 });
    expect(wakeCluster(rows)).toEqual({ minutes: 390, dreams: 6, label: "Your dreams cluster about 6 h 30 min after bedtime" });
    expect(wakeCluster(rows.slice(0, 4))).toBeNull();
  });
});
