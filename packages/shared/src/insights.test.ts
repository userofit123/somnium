import { describe, expect, it } from "vitest";
import {
  bucketOf, bucketRange, periodStart, recallInsight, lucidityInsight, eventsInsight, emotionsInsight, checksInsight,
  compareLucid, whatWorks, sleepHours, utcClock, MIN_NIGHTS, type InsightNight, type InsightDream,
} from "./insights";
import { addDays } from "./rates";

const night = (date: string, o: Partial<InsightNight> = {}): InsightNight => ({ id: `n${date}${o.nap ? "n" : ""}`, date, noRecall: false, dreamCount: 0, ...o });
const dream = (n: InsightNight, o: Partial<InsightDream> = {}): InsightDream => ({ nightId: n.id, lucid: false, ...o });

describe("insights: periods and buckets", () => {
  it("finds the period's first morning and the week or month of a date", () => {
    expect(periodStart("4w", "2026-11-07")).toBe("2026-10-11");
    expect(periodStart("all", "2026-11-07")).toBeNull();
    expect(bucketOf("2026-11-08", "week")).toBe("2026-11-02"); // a Sunday belongs to the Monday before
    expect(bucketOf("2026-11-02", "week")).toBe("2026-11-02");
    expect(bucketOf("2026-11-08", "month")).toBe("2026-11");
    expect(bucketRange("2025-11-20", "2026-02-01", "month")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(bucketRange("2026-11-01", "2026-11-10", "week")).toEqual(["2026-10-26", "2026-11-02", "2026-11-09"]);
  });
});

describe("insights: recall", () => {
  it("counts dreams per night and nights with recall by week and weekday, plans and naps left out", () => {
    const a = night("2026-11-02", { dreamCount: 2 }), b = night("2026-11-03", { noRecall: true }), c = night("2026-11-10", { dreamCount: 1 });
    const plan = night("2026-11-04", { techniquesPlanned: ["mild"] } as Partial<InsightNight>);
    const nap = night("2026-11-03", { nap: true, dreamCount: 1 });
    const dreams = [dream(a), dream(a), dream(c), dream(nap)];
    const r = recallInsight([a, b, c, plan, nap], dreams, null, "2026-11-12");
    expect(r).toMatchObject({ nights: 3, withRecall: 2, dreams: 3, napDreams: 1 });
    expect(r.byBucket.map((w) => [w.key, w.nights, w.withRecall, w.dreams])).toEqual([["2026-11-02", 2, 1, 2], ["2026-11-09", 1, 1, 1]]);
    expect(r.byWeekday[0]).toMatchObject({ key: "Mon", nights: 1, withRecall: 1, dreams: 2 }); // 2 Nov
    expect(r.byWeekday[1]).toMatchObject({ key: "Tue", nights: 2, withRecall: 1, dreams: 1 }); // 3 and 10 Nov
  });
});

describe("insights: naps, one rule", () => {
  // a nap is not a night (no night count takes it in), but its dreams are dreams (every dream count does)
  const a = night("2026-11-02", { dreamCount: 1 }), b = night("2026-11-03", { dreamCount: 1 });
  const nap = night("2026-11-03", { nap: true, dreamCount: 1 });
  const dreams = [dream(a), dream(b, { lucid: true }), dream(nap, { lucid: true, lucidityLevel: 2, nightmare: true, emotionOverall: 1 })];
  it("leaves naps out of every night count and keeps their dreams in every dream count", () => {
    const r = recallInsight([a, b, nap], dreams, null, "2026-11-07");
    const l = lucidityInsight([a, b, nap], dreams, null, "2026-11-07");
    expect(r).toMatchObject({ nights: 2, dreams: 2, napDreams: 1 });
    expect(l).toMatchObject({ nights: r.nights, lucidNights: 1, lucid: 2, dreams: r.dreams + r.napDreams });
    expect(l.levels[2]).toBe(1);
    expect(eventsInsight([a, b, nap], dreams, null, "2026-11-07").total.nightmares).toBe(1);
    expect(emotionsInsight([a, b, nap], dreams, null, "2026-11-07").rated).toBe(1);
  });
  it("reads a lucid night from the night's own count when the dream isn't in the list", () => {
    const ns = Array.from({ length: 20 }, (_, i) => night(addDays("2026-10-01", i), { dreamCount: 1, lucidCount: i < 4 ? 1 : 0, wbtbUsed: i % 2 === 0 }));
    const w = compareLucid(ns, [], { id: "x", label: "x", has: (n) => !!n.wbtbUsed, withNoun: { one: "a", many: "a" }, withoutNoun: { one: "b", many: "b" } });
    expect(w.with.lucid + w.without.lucid).toBe(4);
  });
});

describe("insights: lucidity, events, emotions", () => {
  const a = night("2026-09-10", { dreamCount: 2 }), b = night("2026-11-01", { dreamCount: 2 });
  const dreams = [
    dream(a, { lucid: true, lucidityLevel: 3, becameLucidHow: "reality_check", nightmare: true, emotionOverall: -2 }),
    dream(a, { falseAwakening: true, emotionOverall: 0 }),
    dream(b, { lucid: true, lucidityLevel: 5, becameLucidHow: "wild", sleepParalysis: true, emotionOverall: 2 }),
    dream(b, { lucid: true, becameLucidHow: null }),
  ];
  it("counts lucid dreams per month, levels and how lucidity started", () => {
    const l = lucidityInsight([a, b], dreams, null, "2026-11-07");
    expect(l).toMatchObject({ lucid: 3, dreams: 4, lucidNights: 2, nights: 2 });
    expect(l.byBucket).toEqual([{ key: "2026-09", lucid: 1, dreams: 2 }, { key: "2026-10", lucid: 0, dreams: 0 }, { key: "2026-11", lucid: 2, dreams: 2 }]);
    expect(l.levels).toEqual([1, 0, 0, 1, 0, 1]);
    expect(l.how).toEqual([{ how: "reality_check", count: 1 }, { how: "wild", count: 1 }, { how: "unknown", count: 1 }]);
    // a period leaves the older night out
    expect(lucidityInsight([a, b], dreams, "2026-10-15", "2026-11-07").lucid).toBe(2);
  });
  it("counts nightmares, false awakenings and sleep paralysis, and the feeling of the dreams", () => {
    const e = eventsInsight([a, b], dreams, null, "2026-11-07");
    expect(e.total).toEqual({ nightmares: 1, falseAwakenings: 1, sleepParalysis: 1 });
    expect(e.byBucket[0]).toEqual({ key: "2026-09", nightmares: 1, falseAwakenings: 1, sleepParalysis: 0 });
    const m = emotionsInsight([a, b], dreams, null, "2026-11-07");
    expect(m.rated).toBe(3);
    expect(m.byBucket[0]).toMatchObject({ key: "2026-09", rated: 2, avg: -1, unpleasant: 1, neutral: 1, pleasant: 0 });
    expect(m.byBucket[1]!.avg).toBeNull();
  });
});

describe("insights: reality checks", () => {
  it("counts per day with zeros, by kind, prompted against own and by outcome", () => {
    const cs = [
      { at: "2026-11-05T09:00:00Z", kind: "nose" as const, outcome: "awake" as const, prompted: true },
      { at: "2026-11-05T12:00:00Z", kind: "nose" as const, outcome: "awake" as const, prompted: false },
      { at: "2026-11-07T03:00:00Z", kind: "hands" as const, outcome: "dreaming" as const, prompted: false },
      { at: "2026-10-01T03:00:00Z", kind: "text" as const, outcome: "unsure" as const, prompted: false },
    ];
    const r = checksInsight(cs, "2026-11-04", "2026-11-07", utcClock);
    expect(r.perDay).toEqual([{ key: "2026-11-04", count: 0 }, { key: "2026-11-05", count: 2 }, { key: "2026-11-06", count: 0 }, { key: "2026-11-07", count: 1 }]);
    expect(r).toMatchObject({ total: 3, days: 4, perDayAvg: 0.75, prompted: 1, own: 2, byOutcome: { awake: 2, unsure: 0, dreaming: 1 } });
    expect(r.byKind).toEqual([{ kind: "nose", count: 2 }, { kind: "hands", count: 1 }]);
    expect(checksInsight([], null, "2026-11-07").perDay).toEqual([]);
  });
});

describe("insights: what works for you", () => {
  // 12 WBTB nights with 3 lucid, 30 others with 2 lucid: the example sentence of LDJ-22
  const start = "2026-08-01";
  const nights: InsightNight[] = [], dreams: InsightDream[] = [];
  for (let i = 0; i < 42; i++) {
    const wbtb = i < 12;
    const n = night(addDays(start, i), {
      dreamCount: 1, wbtbUsed: wbtb, wbtbMinutesAwake: wbtb ? (i < 6 ? 20 : 45) : null,
      techniquesDone: wbtb ? ["mild", "wbtb"] : i < 20 ? ["mild"] : [],
      bedtime: `${addDays(start, i - 1)}T23:30:00Z`, wakeTime: `${addDays(start, i)}T07:00:00Z`,
    });
    nights.push(n);
    dreams.push(dream(n, { lucid: wbtb ? i < 3 : i >= 40 }));
  }

  it("says it plainly, with both sample sizes and rates, when both groups have enough nights", () => {
    const w = whatWorks(nights, dreams, utcClock);
    expect(w.wbtb).toMatchObject({ enough: true, with: { nights: 12, lucid: 3, rate: 0.25 }, without: { nights: 30, lucid: 2 } });
    expect(w.wbtb.text).toBe("On your 12 WBTB nights you were lucid on 3 (25%); on your 30 other nights on 2 (7%).");
    expect(w.wbtb.text).not.toMatch(/caus/i);
    // MILD on 20 nights, without on 22
    expect(w.techniques.map((t) => t.id)).toEqual(["technique:mild"]); // WBTB has its own comparison
    expect(w.techniques[0]).toMatchObject({ enough: true, with: { nights: 20, lucid: 3 }, without: { nights: 22, lucid: 2 } });
  });

  it("shows no rate under the minimum on either side", () => {
    const w = whatWorks(nights, dreams, utcClock);
    const [lt15, b15, b30] = w.wbtbBands;
    expect(lt15).toMatchObject({ enough: false, with: { nights: 0, rate: null }, without: { nights: 30, rate: null } });
    expect(b15!.with.nights).toBe(6);
    expect(b30!.text).toBe(`Not enough nights yet: 6 WBTB nights awake 30-60 min and 30 nights without WBTB so far, ${MIN_NIGHTS} of each needed.`);
    expect(b30!.text).not.toMatch(/%/);
    // all nights go to bed at 23:30 and sleep 7.5 h less any WBTB minutes: no "other" group to compare with
    const bed = w.bedtime.find((c) => c.id === "bedtime:23-00")!;
    expect(bed).toMatchObject({ enough: false, with: { nights: 42 }, without: { nights: 0 } });
    expect(w.sleep.find((c) => c.id === "sleep:7-8")!.with.nights).toBe(36); // 30 plain + 6 with 20 min awake
    expect(w.sleep.find((c) => c.id === "sleep:6-7")!.with.nights).toBe(6); // 45 min awake
    expect(w.nap).toMatchObject({ enough: false, with: { nights: 0 }, without: { nights: 42 } });
    expect(w.nap.text).toBe("Not enough nights yet: 0 naps and 42 nights so far, 10 of each needed.");
  });

  it("compares nights asleep within 10 minutes of the technique with longer ones, only where it was logged", () => {
    expect(whatWorks(nights, dreams, utcClock).asleep).toMatchObject({ enough: false, with: { nights: 0 }, without: { nights: 0 } });
    // the sealed column opens as text: 12 nights within 10 minutes (3 lucid), 10 longer (none), the rest not logged
    const timed = nights.map((n, i) => ({ ...n, minutesToSleep: i < 12 ? String(i % 3 ? 5 : 10) : i < 22 ? "25" : null }));
    const a = whatWorks(timed, dreams, utcClock).asleep;
    expect(a).toMatchObject({ id: "asleep", enough: true, with: { nights: 12, lucid: 3, rate: 0.25 }, without: { nights: 10, lucid: 0, rate: 0 } });
    expect(a.text).toBe("On your 12 nights asleep within 10 min you were lucid on 3 (25%); on your 10 nights it took longer on 0 (0%).");
  });

  it("is reusable for any split, and ignores plans and dreams of other nights", () => {
    const plan = night("2026-12-01", { techniquesPlanned: ["mild"] } as Partial<InsightNight>);
    const c = compareLucid([...nights, plan], [...dreams, dream(night("1999-01-01"), { lucid: true })], {
      id: "x", label: "x", has: (n) => n.date < "2026-08-21", withNoun: { one: "early night", many: "early nights" }, withoutNoun: { one: "late night", many: "late nights" },
    });
    expect(c).toMatchObject({ enough: true, with: { nights: 20, lucid: 3, rate: 0.15 }, without: { nights: 22, lucid: 2 } });
    expect(c.text).toBe("On your 20 early nights you were lucid on 3 (15%); on your 22 late nights on 2 (9%).");
  });

  it("works out hours asleep less the time awake", () => {
    expect(sleepHours({ id: "a", date: "x", bedtime: "2026-11-06T23:00:00Z", wakeTime: "2026-11-07T07:00:00Z", wbtbMinutesAwake: 30 })).toBe(7.5);
    expect(sleepHours({ id: "a", date: "x", bedtime: null, wakeTime: "2026-11-07T07:00:00Z" })).toBeNull();
  });
});
