import { describe, expect, it } from "vitest";
import { recallRate, lucidRate, journalStreak, addDays } from "./rates";

describe("rates", () => {
  it("counts recall over logged nights, no-recall nights included", () => {
    expect(recallRate([])).toBe(0);
    expect(recallRate([{ dreamCount: 2 }, { dreamCount: 0 }, { dreamCount: 1 }, { dreamCount: 0 }])).toBe(0.5);
  });

  it("counts lucid dreams per night and lucid nights", () => {
    const nights = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
    const dreams = [
      { nightId: "a", lucid: true }, { nightId: "a", lucid: true }, { nightId: "b", lucid: false },
      { nightId: "c", lucid: true }, { nightId: "zzz", lucid: true }, // another night: not counted
    ];
    expect(lucidRate(nights, dreams)).toEqual({ perNight: 0.75, nightShare: 0.5 });
    expect(lucidRate([], dreams)).toEqual({ perNight: 0, nightShare: 0 });
  });

  it("counts the streak back from today, letting this morning wait", () => {
    const nights = [{ date: "2026-11-05" }, { date: "2026-11-04" }, { date: "2026-11-03" }, { date: "2026-11-01" }];
    expect(journalStreak(nights, "2026-11-05")).toBe(3);
    expect(journalStreak(nights, "2026-11-06")).toBe(3); // today not logged yet
    expect(journalStreak(nights, "2026-11-07")).toBe(0); // a day missed
    expect(journalStreak([], "2026-11-07")).toBe(0);
  });

  it("steps dates across month and year ends", () => {
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2025-12-31", 1)).toBe("2026-01-01");
  });
});
