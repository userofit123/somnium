import { describe, expect, it } from "vitest";
import {
  bucketOf, bucketRange, periodStart, recallInsight, lucidityInsight, eventsInsight, emotionsInsight, checksInsight,
  compareLucid, checksBySign, whatWorks, sleepHours, utcClock, recallProgress, recallChangeText, lucidRecipes, techniqueTally, lucidQuality, qualityText, sleepInsight, sleepWbtbText, retakeDue, loggedRates, RETAKE_DAYS, QUALITY_MIN, SLEEP_MIN_NIGHTS, MIN_NIGHTS, type InsightNight, type InsightDream,
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
    expect(e.total).toEqual({ nightmares: 1, badDreams: 0, falseAwakenings: 1, sleepParalysis: 1 });
    expect(e.byBucket[0]).toEqual({ key: "2026-09", nightmares: 1, badDreams: 0, falseAwakenings: 1, sleepParalysis: 0 });
    const m = emotionsInsight([a, b], dreams, null, "2026-11-07");
    expect(m.rated).toBe(3);
    expect(m.byBucket[0]).toMatchObject({ key: "2026-09", rated: 2, avg: -1, unpleasant: 1, neutral: 1, pleasant: 0 });
    expect(m.byBucket[1]!.avg).toBeNull();
  });
  it("counts bad dreams apart from nightmares, and a dream marked both only as a nightmare", () => {
    const n = night("2026-11-02", { dreamCount: 3 });
    const ds = [dream(n, { badDream: true }), dream(n, { badDream: true }), dream(n, { nightmare: true, badDream: true })];
    const e = eventsInsight([n], ds, null, "2026-11-07");
    expect(e.total).toMatchObject({ nightmares: 1, badDreams: 2 });
    expect(e.byBucket).toEqual([{ key: "2026-11", nightmares: 1, badDreams: 2, falseAwakenings: 0, sleepParalysis: 0 }]);
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
    expect(w.wbtb.text).toBe("On your 12 WBTB nights you were lucid on 3 (25%); on your 30 other nights, you were lucid on 2 (7%).");
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
    expect(a.text).toBe("On your 12 nights asleep within 10 min you were lucid on 3 (25%); on your 10 nights it took more than 10 min to fall asleep, you were lucid on 0 (0%).");
  });

  it("is reusable for any split, and ignores plans and dreams of other nights", () => {
    const plan = night("2026-12-01", { techniquesPlanned: ["mild"] } as Partial<InsightNight>);
    const c = compareLucid([...nights, plan], [...dreams, dream(night("1999-01-01"), { lucid: true })], {
      id: "x", label: "x", has: (n) => n.date < "2026-08-21", withNoun: { one: "early night", many: "early nights" }, withoutNoun: { one: "late night", many: "late nights" },
    });
    expect(c).toMatchObject({ enough: true, with: { nights: 20, lucid: 3, rate: 0.15 }, without: { nights: 22, lucid: 2 } });
    expect(c.text).toBe("On your 20 early nights you were lucid on 3 (15%); on your 22 late nights, you were lucid on 2 (9%).");
  });

  it("works out hours asleep less the time awake", () => {
    expect(sleepHours({ id: "a", date: "x", bedtime: "2026-11-06T23:00:00Z", wakeTime: "2026-11-07T07:00:00Z", wbtbMinutesAwake: 30 })).toBe(7.5);
    expect(sleepHours({ id: "a", date: "x", bedtime: null, wakeTime: "2026-11-07T07:00:00Z" })).toBeNull();
  });
});

describe("insights: recall progress (LDJ-113)", () => {
  const today = "2026-11-15";
  // n days back from today, with that many dreams
  const ago = (k: number, dreams: number, o: Partial<InsightNight> = {}) => night(addDays(today, -k), { dreamCount: dreams, noRecall: !dreams, ...o });

  it("sets the last two weeks against the first 14 logged nights before them", () => {
    const early = Array.from({ length: 14 }, (_, i) => ago(40 - i, i % 2)); // 40..27 days back: 7 dreams over 14 nights
    const late = Array.from({ length: 14 }, (_, i) => ago(13 - i, 2)); // the last 14 mornings: 2 a night
    const p = recallProgress([...early, ...late, ago(3, 5, { nap: true, id: "nap" })], [], today);
    expect(p.start).toMatchObject({ nights: 14, dreams: 7, perNight: 0.5, from: addDays(today, -40), to: addDays(today, -27) });
    expect(p.now).toEqual({ nights: 14, dreams: 28, perNight: 2 }); // the nap is not a night
    expect(p.base).toEqual({ perNight: 0.5, from: "journal" });
    expect(p.reached).toEqual({ run: true, twoANight: true });
    expect(p.run).toBe(14);
    expect(recallChangeText(p)).toBe("Up from 0.5 to 2 dreams a night, against your first logged nights");
    expect(p.weekly[0]!.key).toBe(bucketOf(addDays(today, -40), "week"));
  });

  it("has no starting point with fewer than 7 nights before the last two weeks, and prefers the setup answer", () => {
    const ns = Array.from({ length: 20 }, (_, i) => ago(19 - i, 1));
    expect(recallProgress(ns, [], today).start).toBeNull();
    expect(recallProgress(ns, [], today).base).toBeNull();
    expect(recallChangeText(recallProgress(ns, [], today))).toBe("");
    const p = recallProgress(ns, [], today, { perNight: 1 / 7, label: "About once a week" });
    expect(p.base).toEqual({ perNight: 1 / 7, from: "setup" });
    expect(p.said?.label).toBe("About once a week");
    expect(recallChangeText(p)).toBe("Up from 0.1 to 1 dream a night, against what you said at the start");
  });

  it("counts nights in a row with a dream: a gap, a no-recall night or an old last night ends the run", () => {
    const run = [ago(10, 1), ago(9, 1), ago(8, 0), ago(6, 1), ago(5, 2), ago(4, 1), ago(3, 1), ago(2, 1), ago(1, 1)];
    const p = recallProgress(run, [], today);
    expect([p.run, p.bestRun, p.reached.run]).toEqual([6, 6, false]);
    expect(recallProgress(run.slice(0, -2), [], today).run).toBe(0); // last logged 3 days back
    expect(recallProgress([...run, ago(0, 1)], [], today)).toMatchObject({ run: 7, reached: { run: true } });
  });

  it("counts a night's dreams from its dream list when given, and says when nothing changed", () => {
    const early = Array.from({ length: 7 }, (_, i) => ago(30 - i, 0));
    const late = Array.from({ length: 7 }, (_, i) => ago(7 - i, 0));
    const p = recallProgress([...early, ...late], [...early, ...late].map((n) => dream(n)), today);
    expect(p.start).toMatchObject({ nights: 7, perNight: 1 });
    expect(p.now).toMatchObject({ nights: 7, perNight: 1 });
    expect(recallChangeText(p)).toBe("About the same as your first logged nights: 1 dream a night");
    expect(recallProgress([], [], today)).toMatchObject({ now: { nights: 0, perNight: null }, start: null, run: 0, weekly: [] });
  });

  it("takes the first 14 logged nights, not 14 calendar days, and compares nothing under 7 nights a side", () => {
    // every other morning from 60 days back: the first 14 logged nights run from 60 to 34 days back
    const early = Array.from({ length: 20 }, (_, i) => ago(60 - 2 * i, i < 14 ? 1 : 3));
    const late = Array.from({ length: 7 }, (_, i) => ago(6 - i, 2));
    const p = recallProgress([...early, ...late], [], today);
    expect(p.start).toMatchObject({ nights: 14, dreams: 14, perNight: 1, from: addDays(today, -60), to: addDays(today, -34) });
    expect(recallChangeText(p)).toBe("Up from 1 to 2 dreams a night, against your first logged nights");
    // six nights in the last two weeks: a starting point, but no comparison and no target reached
    const thin = recallProgress([...early, ...late.slice(1)], [], today);
    expect(thin.base).not.toBeNull();
    expect(recallChangeText(thin)).toBe("");
    expect(recallProgress([...early, ...late.slice(1).map((n) => ({ ...n, dreamCount: 3 }))], [], today).reached.twoANight).toBe(false);
    // six nights before them: no starting point
    expect(recallProgress([...early.slice(0, 6), ...late], [], today).start).toBeNull();
  });

  it("counts two logs on one morning as one night, and leaves out plans and naps", () => {
    const d = addDays(today, -2);
    const twice = [night(d, { id: "a", dreamCount: 1 }), night(d, { id: "b", dreamCount: 2 })];
    const plan = night(addDays(today, -3)); // nothing logged, no "No recall" mark: a plan
    const nap = night(addDays(today, -1), { nap: true, dreamCount: 4 });
    const sameDay = night(addDays(today, -1), { dreamCount: 1 });
    const all = [...twice, plan, nap, sameDay];
    const p = recallProgress(all, [], today);
    expect(p.now).toEqual({ nights: 2, dreams: 4, perNight: 2 });
    const r = recallInsight(all, [], addDays(today, -13), today);
    expect([r.nights, r.withRecall, r.dreams, r.napDreams]).toEqual([p.now.nights, 2, p.now.dreams, 0]);
    expect(p.weekly.reduce((a, w) => a + w.nights, 0)).toBe(2);
  });
});

describe("insights: early results per technique (LDJ-109)", () => {
  const a = night("2026-11-02", { dreamCount: 1, wbtbUsed: true, wbtbMinutesAwake: 45, techniquesDone: ["mild"], minutesToSleep: "5", bedtime: "2026-11-01T23:10:00Z" });
  const b = night("2026-11-03", { dreamCount: 1, techniquesDone: ["mild"] });
  const c = night("2026-11-04", { dreamCount: 1, techniquesDone: ["ssild", "wbtb"] });
  const d = night("2026-11-05", { dreamCount: 1 });
  const nap = night("2026-11-05", { nap: true, dreamCount: 1, techniquesDone: ["mild"] });
  const plan = night("2026-11-06", { techniquesPlanned: ["mild"] } as Partial<InsightNight>);
  const dreams = [dream(a, { id: "da", lucid: true }), dream(a, { id: "da2", lucid: true }), dream(b), dream(c), dream(d, { id: "dd", lucid: true }), dream(nap, { id: "dn", lucid: true })];

  it("gives each lucid night its recipe in one line, newest first, naps included", () => {
    const r = lucidRecipes([a, b, c, d, nap, plan], dreams, utcClock);
    expect(r.map((x) => [x.date, x.nap, x.lucid, x.dreamId])).toEqual([["2026-11-05", false, 1, "dd"], ["2026-11-05", true, 1, "dn"], ["2026-11-02", false, 2, "da"]]);
    expect(r[2]!.text).toBe("WBTB 45 min · MILD · asleep in 5 min · in bed 23:10");
    expect(r[0]!.text).toBe("Nothing logged before it");
    expect(r[1]!.text).toBe("MILD");
  });

  it("takes the engine's lucid count when the dreams are not given", () => {
    const r = lucidRecipes([{ ...b, lucidCount: 1 }], [], utcClock);
    expect(r).toMatchObject([{ date: "2026-11-03", lucid: 1, dreamId: null, text: "MILD" }]);
  });

  it("counts each technique's nights and lucid nights plainly, WBTB from either field, naps and plans left out", () => {
    const t = techniqueTally([a, b, c, d, nap, plan], dreams, utcClock);
    expect(t.map((x) => [x.id, x.nights, x.lucid, x.early])).toEqual([["mild", 2, 1, true], ["wbtb", 2, 1, true], ["ssild", 1, 0, true]]);
    expect(t[0]!.text).toBe("1 lucid night of 2 tried");
    expect(t[2]!.text).toBe("0 lucid nights of 1 tried");
    expect(t[0]!.list.map((r) => r.date)).toEqual(["2026-11-03", "2026-11-02"]);
    expect(t.map((x) => x.text).join(" ")).not.toMatch(/%|caus/i);
  });

  it("stops calling the numbers early once a technique has MIN_NIGHTS nights", () => {
    const ns = Array.from({ length: MIN_NIGHTS }, (_, i) => night(addDays("2026-10-01", i), { dreamCount: 1, techniquesDone: ["mild"] }));
    expect(techniqueTally(ns, [], utcClock)[0]).toMatchObject({ id: "mild", nights: MIN_NIGHTS, lucid: 0, early: false });
    expect(techniqueTally(ns.slice(1), [], utcClock)[0]!.early).toBe(true);
  });
});

describe("insights: checks per dream sign (LDJ-200)", () => {
  const c = (at: string, signId: string | null, outcome: "awake" | "dreaming" = "awake") => ({ at, kind: "nose" as const, outcome, prompted: true, signId });
  const links = [{ dreamId: "d1", elementId: "teeth", source: "manual" as const }, { dreamId: "d2", elementId: "teeth", source: "manual" as const }];
  const dreams = [{ id: "d1", date: "2026-11-02", lucid: true, becameLucidHow: "dream_sign" }, { id: "d2", date: "2026-11-03", lucid: true, becameLucidHow: "other" }, { id: "d3", date: "2026-11-04", lucid: false }];
  it("counts checks and lucid dreams per sign, keeps unpaired apart and stays inside the range", () => {
    const cs = [c("2026-11-05T09:00:00Z", "teeth"), c("2026-11-05T10:00:00Z", "teeth", "dreaming"), c("2026-11-06T10:00:00Z", "stairs"), c("2026-11-06T11:00:00Z", null), c("2026-10-01T10:00:00Z", "stairs")];
    const r = checksBySign(cs, links, dreams, "2026-11-01", "2026-11-07", utcClock);
    expect(r.unpaired).toBe(1);
    expect(r.rows).toEqual([
      { elementId: "teeth", checks: 2, dreaming: 1, lucidViaSign: 1 },
      { elementId: "stairs", checks: 1, dreaming: 0, lucidViaSign: 0 },
    ]);
  });
  it("is empty with no checks", () => { expect(checksBySign([], links, dreams, null, "2026-11-07")).toEqual({ rows: [], unpaired: 0 }); });
});

describe("insights: lucid dream quality (LDJ-165)", () => {
  const today = "2026-11-15";
  // three lucid dreams in the summer at level 1, three this autumn at level 3 (one at 4), plus a non-lucid dream
  const old = ["2026-06-02", "2026-06-10", "2026-07-01"].map((d) => night(d, { dreamCount: 1 }));
  const now = ["2026-10-01", "2026-10-20", "2026-11-02", "2026-11-10"].map((d) => night(d, { dreamCount: 1 }));
  const dreams = [
    ...old.map((n) => dream(n, { lucid: true, lucidityLevel: 1, control: 0, durationEst: 0 })),
    dream(now[0]!, { lucid: true, lucidityLevel: 3, control: 2, durationEst: 3, lucidEnd: "woke" }),
    dream(now[1]!, { lucid: true, lucidityLevel: 3, control: 4, durationEst: 10, lucidEnd: "lost" }),
    dream(now[2]!, { lucid: true, lucidityLevel: 4, durationEst: 1, lucidEnd: "woke" }),
    dream(now[3]!, { lucid: true, lucidityLevel: 3 }),
    dream(now[3]!, { lucidityLevel: 0 }),
  ];
  it("averages level and control by month from the first lucid dream, gaps included", () => {
    const q = lucidQuality([...old, ...now], dreams, today);
    expect(q.byMonth.map((r) => r.key)).toEqual(["2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"]);
    expect(q.byMonth[0]).toMatchObject({ lucid: 2, level: 1, control: 0 });
    expect(q.byMonth[2]).toMatchObject({ lucid: 0, level: null, control: null });
    expect(q.byMonth[4]).toMatchObject({ lucid: 2, level: 3, control: 3 });
    expect(q.byMonth[5]).toMatchObject({ lucid: 2, level: 3.5, controlled: 0, control: null });
  });
  it("counts the lucid dreams that lasted a few minutes or longer, and how they ended", () => {
    const q = lucidQuality([...old, ...now], dreams, today);
    expect(q.recent).toMatchObject({ lucid: 4, timed: 3, long: 2, ends: { woke: 2, lost: 1 } });
    expect(q.all).toMatchObject({ lucid: 7, timed: 6, long: 2 });
  });
  it("says the most common level now against before, only once each side has enough", () => {
    const q = lucidQuality([...old, ...now], dreams, today);
    expect(q.recent.mostly).toBe(3);
    expect(q.before.mostly).toBe(1);
    expect(q.text).toBe("Your lucid dreams in the last 3 months: mostly level 3, up from level 1");
    // only two from before: no comparison
    expect(lucidQuality([...old.slice(1), ...now], dreams, today).text).toContain(`A comparison shows once ${QUALITY_MIN}`);
    expect(lucidQuality(old.slice(0, 2), dreams, today).text).toBe(`2 lucid dreams with a level so far: too few to say what is typical. It shows at ${QUALITY_MIN}`);
    expect(lucidQuality([], [], today)).toMatchObject({ byMonth: [], text: "" });
  });
  it("breaks a tie toward the lower level, so the summary never flatters", () => {
    const w = { leveled: 4, mostly: 2 } as const;
    expect(qualityText({ all: { ...w } as never, recent: { leveled: 4, mostly: 2 } as never, before: { leveled: 3, mostly: 2 } as never })).toBe("Your lucid dreams in the last 3 months: mostly level 2, as before");
    const tie = ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04"].map((d) => night(d, { dreamCount: 1 }));
    const q = lucidQuality(tie, tie.map((n, i) => dream(n, { lucid: true, lucidityLevel: i < 2 ? 2 : 4 })), today);
    expect(q.recent.mostly).toBe(2);
  });
});

describe("insights: sleep (LDJ-160)", () => {
  const today = "2026-11-15";
  // bed at 23:00 or 00:00 UTC (alternating), up at 07:00: 8 or 7 hours; every third night WBTB with 60 min awake
  const at = (ymd: string, hh: number) => new Date(Date.parse(ymd + "T00:00:00Z") + hh * 3_600_000).toISOString();
  const ns = Array.from({ length: 30 }, (_, i) => {
    const date = addDays(today, -29 + i);
    const wbtb = i % 3 === 0;
    return night(date, { dreamCount: 1, bedtime: at(date, i % 2 ? -1 : 0), wakeTime: at(date, 7), wbtbUsed: wbtb, wbtbMinutesAwake: wbtb ? 60 : null, sleepQuality: wbtb ? 3 : 4 });
  });
  it("shows nothing but the count until enough nights have times", () => {
    const s = sleepInsight(ns.slice(0, SLEEP_MIN_NIGHTS - 1), null, today, "week", utcClock);
    expect(s).toMatchObject({ timed: SLEEP_MIN_NIGHTS - 1, enough: false, hours: null, bedtime: null, spread: null });
    expect(sleepInsight([night(today, { dreamCount: 1, bedtime: at(today, -1) })], null, today, "week", utcClock).timed).toBe(0);
  });
  it("averages hours asleep (less WBTB time), the usual bedtime and how much it strays", () => {
    const s = sleepInsight(ns, null, today, "week", utcClock);
    expect(s.enough).toBe(true);
    expect(s.timed).toBe(30);
    expect(s.hours).toBeCloseTo((15 * 8 + 15 * 7 - 10) / 30, 5);
    expect(s.bedtime).toBe(23 * 60 + 30);
    expect(s.spread).toBe(30);
    expect(s.byBucket.reduce((a, r) => a + r.nights, 0)).toBe(30);
    expect(s.bedtimes[0]).toEqual({ date: ns[0]!.date, min: 720 }); // 00:00 is 720 minutes after noon
  });
  it("leaves naps out: they are not nights", () => {
    const nap = night(today, { nap: true, bedtime: at(today, 13), wakeTime: at(today, 14) });
    expect(sleepInsight([...ns, nap], null, today, "week", utcClock).timed).toBe(30);
  });
  it("sets WBTB nights against the others only once both have enough", () => {
    const s = sleepInsight(ns, null, today, "week", utcClock);
    expect(s.wbtb).toMatchObject({ timed: 10, rated: 10, quality: 3 });
    expect(s.other).toMatchObject({ timed: 20, rated: 20, quality: 4 });
    expect(sleepWbtbText(s)).toMatch(/^.* h asleep on WBTB nights, .* h on others; sleep rated 3 of 5 on WBTB nights, 4 on others \(10 WBTB nights, 20 other nights\)$/);
    const few = sleepInsight(ns.slice(-15), null, today, "week", utcClock);
    expect(few.wbtb.quality).toBeNull();
    expect(sleepWbtbText(few)).toBe(`Not enough nights yet: 5 WBTB nights and 10 other nights with a sleep rating; it shows at ${MIN_NIGHTS} each`);
  });
  it("flags short sleep over the last nights, only when they are recent", () => {
    expect(sleepInsight(ns, null, today, "week", utcClock).last).toMatchObject({ short: false });
    const short = ns.map((n) => ({ ...n, bedtime: at(n.date, 2), wbtbUsed: false, wbtbMinutesAwake: null }));
    expect(sleepInsight(short, null, today, "week", utcClock).last).toEqual({ hours: 5, short: true });
    // the same nights a month ago: nothing to say about now
    expect(sleepInsight(short, null, addDays(today, 30), "week", utcClock).last).toEqual({ hours: null, short: false });
  });
});

describe("insights: self-assessment retake (LDJ-175)", () => {
  it("is due four weeks after the newest answer of either scale, never with no answers", () => {
    const today = "2026-11-15";
    expect(retakeDue([], today)).toBe(false);
    expect(retakeDue([undefined, null], today)).toBe(false);
    expect(retakeDue([addDays(today, -RETAKE_DAYS)], today)).toBe(true);
    expect(retakeDue([addDays(today, -(RETAKE_DAYS - 1))], today)).toBe(false);
    expect(retakeDue([addDays(today, -60), addDays(today, -3)], today)).toBe(false); // the newer answer counts
  });
  it("gives the logged rates of the four weeks up to a date in the scales' units", () => {
    const to = "2026-11-15";
    const ns = Array.from({ length: 14 }, (_, i) => night(addDays(to, -i), { dreamCount: i % 2 ? 0 : 1, noRecall: !!(i % 2) }));
    const old = night(addDays(to, -40), { dreamCount: 3 });
    const ds = [...ns.filter((n) => n.dreamCount).map((n, i) => dream(n, { lucid: i < 2 })), dream(old, { lucid: true })];
    const r = loggedRates([...ns, old], ds, to);
    expect(r.nights).toBe(14);
    expect(r.recallPerWeek).toBeCloseTo(3.5);
    expect(r.lucidPerMonth).toBeCloseTo((2 / 14) * 30.4);
    expect(loggedRates(ns.slice(0, 3), ds, to)).toEqual({ nights: 3, lucidPerMonth: null, recallPerWeek: null });
  });
});
