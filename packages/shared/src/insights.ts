// Insights (PLAN.md §6.5): pure sums over logged nights, their dreams and the reality checks, computed on the device.
// Plans (a night with only techniques planned) are left out everywhere, as in rates.ts. Dates are the morning's
// YYYY-MM-DD; times of day (bedtime, a check's moment) are read through `clock`, so tests don't depend on the zone.
//
// "What works for you" (LDJ-22) compares lucid nights on nights with something against nights without. It never
// shows a rate when either group has fewer than MIN_NIGHTS nights, gives both sample sizes, and says "went with",
// never "caused": these are the person's own nights, not an experiment. The recommendation rules (PLAN.md §8.2,
// LDJ-27) read the same Comparison objects, so the threshold and wording stay in one place.
import { loggedNights, addDays, type NightLog } from "./rates";
import { TECHNIQUES } from "./journal";
import { BECAME_LUCID_HOW, CHECK_KINDS, CHECK_OUTCOMES, type BecameLucidHow, type CheckKind, type CheckOutcome } from "./types";

/** Fewer nights than this in either group: "not enough nights yet", and no rate. */
export const MIN_NIGHTS = 10;

export interface InsightNight extends NightLog {
  id: string;
  date: string;
  nap?: boolean;
}
export interface InsightDream {
  nightId: string;
  lucid: boolean;
  lucidityLevel?: number | null;
  emotionOverall?: number | null;
  nightmare?: boolean;
  falseAwakening?: boolean;
  sleepParalysis?: boolean;
  becameLucidHow?: BecameLucidHow | null;
}
export interface InsightCheck { at: string; kind: CheckKind; outcome: CheckOutcome; prompted: boolean }

/** Reads an instant as the person's local clock: the date and the minutes since midnight. */
export interface Clock { day(iso: string): string; minutes(iso: string): number }
export const localClock: Clock = {
  day: (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; },
  minutes: (iso) => { const d = new Date(iso); return d.getHours() * 60 + d.getMinutes(); },
};
export const utcClock: Clock = {
  day: (iso) => new Date(iso).toISOString().slice(0, 10),
  minutes: (iso) => { const d = new Date(iso); return d.getUTCHours() * 60 + d.getUTCMinutes(); },
};

// ---------- periods and buckets ----------

export const PERIODS = ["4w", "3m", "1y", "all"] as const;
export type Period = (typeof PERIODS)[number];
export const PERIOD_LABEL: Record<Period, string> = { "4w": "4 weeks", "3m": "3 months", "1y": "A year", all: "All" };

/** The first morning a period covers (inclusive), or null for all of it. */
export function periodStart(p: Period, today: string): string | null {
  return p === "4w" ? addDays(today, -27) : p === "3m" ? addDays(today, -90) : p === "1y" ? addDays(today, -364) : null;
}
/** Weeks for the short periods, months for the long ones, so a chart has a sensible number of bars. */
export const bucketFor = (p: Period): Bucket => (p === "4w" || p === "3m" ? "week" : "month");

export type Bucket = "week" | "month";
const weekday = (ymd: string) => { const [y, m, d] = ymd.split("-").map(Number) as [number, number, number]; return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; }; // Monday 0
/** The Monday of a date's week, or the month (YYYY-MM). */
export const bucketOf = (ymd: string, b: Bucket) => (b === "week" ? addDays(ymd, -weekday(ymd)) : ymd.slice(0, 7));
const nextBucket = (key: string, b: Bucket) => {
  if (b === "week") return addDays(key, 7);
  const [y, m] = key.split("-").map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
};
/** Every bucket from the first to the last, gaps included (a chart with a missing week would hide a dry spell). */
export function bucketRange(from: string, to: string, b: Bucket): string[] {
  const out: string[] = [];
  const last = bucketOf(to, b);
  for (let k = bucketOf(from, b); k <= last && out.length < 2000; k = nextBucket(k, b)) out.push(k);
  return out;
}

/** The logged nights (plans out) whose morning lies in [from, to]; from null means from the start. */
export function nightsIn<N extends InsightNight>(nights: N[], from: string | null, to: string): N[] {
  return loggedNights(nights).filter((n) => (from == null || n.date >= from) && n.date <= to);
}
/** The dreams of the given nights, each with its night's date. */
export function dreamsOf<D extends InsightDream>(nights: InsightNight[], dreams: D[]): (D & { date: string })[] {
  const date = new Map(nights.map((n) => [n.id, n.date]));
  return dreams.filter((d) => date.has(d.nightId)).map((d) => ({ ...d, date: date.get(d.nightId)! }));
}
const span = (nights: { date: string }[], from: string | null, to: string) => {
  const dates = nights.map((n) => n.date).sort();
  return { first: from ?? dates[0] ?? to, last: to };
};

// ---------- recall ----------

export interface RecallRow { key: string; nights: number; withRecall: number; dreams: number }
export interface RecallInsight {
  nights: number; withRecall: number; dreams: number;
  byBucket: RecallRow[];
  /** Monday first. */
  byWeekday: RecallRow[];
}
/** Dreams per night and nights with recall, by week (or month) and by weekday of the morning. Naps are left out: they aren't nights. */
export function recallInsight(nights: InsightNight[], dreams: InsightDream[], from: string | null, to: string, b: Bucket = "week"): RecallInsight {
  const ns = nightsIn(nights, from, to).filter((n) => !n.nap);
  const count = new Map<string, number>();
  for (const d of dreamsOf(ns, dreams)) count.set(d.nightId, (count.get(d.nightId) ?? 0) + 1);
  const dc = (n: InsightNight) => count.get(n.id) ?? n.dreamCount ?? 0;
  const row = (key: string): RecallRow => ({ key, nights: 0, withRecall: 0, dreams: 0 });
  const add = (r: RecallRow, n: InsightNight) => { r.nights++; r.dreams += dc(n); if (dc(n) > 0) r.withRecall++; };
  const { first, last } = span(ns, from, to);
  const buckets = new Map(ns.length ? bucketRange(first, last, b).map((k) => [k, row(k)]) : []);
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(row);
  const total = row("all");
  for (const n of ns) { add(total, n); add(buckets.get(bucketOf(n.date, b)) ?? row(""), n); add(days[weekday(n.date)]!, n); }
  return { nights: total.nights, withRecall: total.withRecall, dreams: total.dreams, byBucket: [...buckets.values()], byWeekday: days };
}

// ---------- lucidity ----------

export interface LucidityInsight {
  lucid: number; dreams: number; lucidNights: number; nights: number;
  byBucket: { key: string; lucid: number; dreams: number }[];
  /** Lucid dreams by level 0-5 (0: marked lucid without a level). */
  levels: number[];
  how: { how: BecameLucidHow | "unknown"; count: number }[];
}
export function lucidityInsight(nights: InsightNight[], dreams: InsightDream[], from: string | null, to: string, b: Bucket = "month"): LucidityInsight {
  const ns = nightsIn(nights, from, to);
  const ds = dreamsOf(ns, dreams);
  const lucid = ds.filter((d) => d.lucid);
  const { first, last } = span(ns, from, to);
  const buckets = new Map(ns.length ? bucketRange(first, last, b).map((k) => [k, { key: k, lucid: 0, dreams: 0 }]) : []);
  for (const d of ds) { const r = buckets.get(bucketOf(d.date, b)); if (r) { r.dreams++; if (d.lucid) r.lucid++; } }
  const levels = [0, 0, 0, 0, 0, 0];
  for (const d of lucid) levels[Math.max(0, Math.min(5, Math.round(d.lucidityLevel ?? 0)))]!++;
  const how = [...BECAME_LUCID_HOW, "unknown" as const].map((h) => ({ how: h, count: lucid.filter((d) => (d.becameLucidHow ?? "unknown") === h).length }));
  return { lucid: lucid.length, dreams: ds.length, lucidNights: new Set(lucid.map((d) => d.nightId)).size, nights: ns.length, byBucket: [...buckets.values()], levels, how: how.filter((h) => h.count > 0) };
}

// ---------- night events and emotions ----------

export interface EventRow { key: string; nightmares: number; falseAwakenings: number; sleepParalysis: number }
export function eventsInsight(nights: InsightNight[], dreams: InsightDream[], from: string | null, to: string, b: Bucket = "month"): { total: Omit<EventRow, "key">; byBucket: EventRow[] } {
  const ns = nightsIn(nights, from, to);
  const { first, last } = span(ns, from, to);
  const buckets = new Map(ns.length ? bucketRange(first, last, b).map((k) => [k, { key: k, nightmares: 0, falseAwakenings: 0, sleepParalysis: 0 }]) : []);
  const total = { nightmares: 0, falseAwakenings: 0, sleepParalysis: 0 };
  for (const d of dreamsOf(ns, dreams)) {
    const r = buckets.get(bucketOf(d.date, b));
    for (const [k, on] of [["nightmares", d.nightmare], ["falseAwakenings", d.falseAwakening], ["sleepParalysis", d.sleepParalysis]] as const) {
      if (!on) continue;
      total[k]++;
      if (r) r[k]++;
    }
  }
  return { total, byBucket: [...buckets.values()] };
}

export interface EmotionRow { key: string; rated: number; avg: number | null; pleasant: number; neutral: number; unpleasant: number }
/** The overall feeling of the dreams (-2..2) per bucket: its average and how many were pleasant, neutral or unpleasant. */
export function emotionsInsight(nights: InsightNight[], dreams: InsightDream[], from: string | null, to: string, b: Bucket = "month"): { rated: number; byBucket: EmotionRow[] } {
  const ns = nightsIn(nights, from, to);
  const { first, last } = span(ns, from, to);
  const buckets = new Map<string, EmotionRow & { sum: number }>(ns.length ? bucketRange(first, last, b).map((k) => [k, { key: k, rated: 0, avg: null, pleasant: 0, neutral: 0, unpleasant: 0, sum: 0 }]) : []);
  let rated = 0;
  for (const d of dreamsOf(ns, dreams)) {
    const e = d.emotionOverall, r = buckets.get(bucketOf(d.date, b));
    if (e == null || !r) continue;
    rated++; r.rated++; r.sum += e;
    if (e > 0) r.pleasant++; else if (e < 0) r.unpleasant++; else r.neutral++;
  }
  return { rated, byBucket: [...buckets.values()].map(({ sum, ...r }) => ({ ...r, avg: r.rated ? sum / r.rated : null })) };
}

// ---------- reality checks ----------

export interface ChecksInsight {
  total: number; days: number; perDayAvg: number;
  perDay: { key: string; count: number }[];
  byKind: { kind: CheckKind; count: number }[];
  prompted: number; own: number;
  byOutcome: Record<CheckOutcome, number>;
}
/** Checks per day (every day in the range, zeros included), by kind, prompted against own, and by outcome ("dreaming" is a lucid moment). */
export function checksInsight(checks: InsightCheck[], from: string | null, to: string, clock: Clock = localClock): ChecksInsight {
  const cs = checks.map((c) => ({ ...c, day: clock.day(c.at) })).filter((c) => (from == null || c.day >= from) && c.day <= to);
  const first = from ?? cs.map((c) => c.day).sort()[0] ?? to;
  const perDay = new Map<string, number>();
  if (cs.length || from) for (let d = first; d <= to && perDay.size < 4000; d = addDays(d, 1)) perDay.set(d, 0);
  for (const c of cs) perDay.set(c.day, (perDay.get(c.day) ?? 0) + 1);
  const byOutcome = Object.fromEntries(CHECK_OUTCOMES.map((o) => [o, cs.filter((c) => c.outcome === o).length])) as Record<CheckOutcome, number>;
  const byKind = CHECK_KINDS.map((k) => ({ kind: k, count: cs.filter((c) => c.kind === k).length })).filter((k) => k.count > 0).sort((a, b) => b.count - a.count);
  const prompted = cs.filter((c) => c.prompted).length;
  return { total: cs.length, days: perDay.size, perDayAvg: perDay.size ? cs.length / perDay.size : 0, perDay: [...perDay].map(([key, count]) => ({ key, count })), byKind, prompted, own: cs.length - prompted, byOutcome };
}

// ---------- what works for you (LDJ-22) ----------

export interface Noun { one: string; many: string }
export interface Group { noun: Noun; nights: number; lucid: number; /** null while either group is under MIN_NIGHTS */ rate: number | null }
export interface Comparison {
  /** Stable id for the recommendation rules, e.g. "wbtb", "technique:mild", "sleep:7-8". */
  id: string;
  label: string;
  with: Group;
  without: Group;
  enough: boolean;
  /** The plain sentence shown to the person. */
  text: string;
}

const plural = (n: number, w: Noun) => `${n} ${n === 1 ? w.one : w.many}`;
const pct = (r: number) => `${Math.round(r * 100)}%`;

/** The sentence for a comparison: both sample sizes always; a rate only with enough nights on both sides. */
export function comparisonText(c: Pick<Comparison, "with" | "without" | "enough">): string {
  const { with: a, without: b } = c;
  if (!c.enough) return `Not enough nights yet: ${plural(a.nights, a.noun)} and ${plural(b.nights, b.noun)} so far, ${MIN_NIGHTS} of each needed.`;
  return `On your ${plural(a.nights, a.noun)} you were lucid on ${a.lucid} (${pct(a.rate!)}); on your ${plural(b.nights, b.noun)} on ${b.lucid} (${pct(b.rate!)}).`;
}

/**
 * Lucid nights among the nights `has` picks against the nights `lacks` picks (by default every other night given).
 * A night is lucid when it has at least one lucid dream. Reusable by the recommendation rules.
 */
export function compareLucid(
  nights: InsightNight[], dreams: InsightDream[],
  o: { id: string; label: string; has: (n: InsightNight) => boolean; lacks?: (n: InsightNight) => boolean; withNoun: Noun; withoutNoun: Noun },
): Comparison {
  const ns = loggedNights(nights);
  const lucidNights = new Set(dreamsOf(ns, dreams).filter((d) => d.lucid).map((d) => d.nightId));
  const group = (pick: (n: InsightNight) => boolean, noun: Noun): Group => {
    const g = ns.filter(pick);
    return { noun, nights: g.length, lucid: g.filter((n) => lucidNights.has(n.id)).length, rate: null };
  };
  const a = group(o.has, o.withNoun), b = group(o.lacks ?? ((n) => !o.has(n)), o.withoutNoun);
  const enough = a.nights >= MIN_NIGHTS && b.nights >= MIN_NIGHTS;
  if (enough) { a.rate = a.lucid / a.nights; b.rate = b.lucid / b.nights; }
  return { id: o.id, label: o.label, with: a, without: b, enough, text: comparisonText({ with: a, without: b, enough }) };
}

const nightsNoun = (what: string): Noun => ({ one: `${what} night`, many: `${what} nights` });
const OTHER: Noun = { one: "other night", many: "other nights" };
const NO_WBTB: Noun = { one: "night without WBTB", many: "nights without WBTB" };

export const isWbtb = (n: InsightNight) => !!n.wbtbUsed || !!n.techniquesDone?.includes("wbtb");

/** Hours asleep: bedtime to wake time, less the minutes awake for WBTB. null when either is missing or it makes no sense. */
export function sleepHours(n: InsightNight): number | null {
  if (!n.bedtime || !n.wakeTime) return null;
  const h = (Date.parse(n.wakeTime) - Date.parse(n.bedtime)) / 3_600_000 - (n.wbtbMinutesAwake ?? 0) / 60;
  return Number.isFinite(h) && h > 0 && h < 24 ? h : null;
}

export const WBTB_BANDS = [
  { id: "lt15", label: "under 15 min", lo: 0, hi: 15 }, { id: "15-30", label: "15-30 min", lo: 15, hi: 30 },
  { id: "30-60", label: "30-60 min", lo: 30, hi: 60 }, { id: "60+", label: "60 min or more", lo: 60, hi: Infinity },
] as const;
export const SLEEP_BANDS = [
  { id: "lt6", label: "under 6 h", lo: 0, hi: 6 }, { id: "6-7", label: "6-7 h", lo: 6, hi: 7 },
  { id: "7-8", label: "7-8 h", lo: 7, hi: 8 }, { id: "8+", label: "8 h or more", lo: 8, hi: Infinity },
] as const;
/** Minutes after noon, so that evening and after-midnight bedtimes sort in order (22:00 is 600, 01:00 is 780). */
export const BEDTIME_BANDS = [
  { id: "lt22", label: "before 22:00", lo: 0, hi: 600 }, { id: "22-23", label: "22:00-23:00", lo: 600, hi: 660 },
  { id: "23-00", label: "23:00-00:00", lo: 660, hi: 720 }, { id: "00+", label: "after 00:00", lo: 720, hi: Infinity },
] as const;
const afterNoon = (min: number) => (min - 720 + 1440) % 1440;

export interface WhatWorks {
  /** One per technique done on at least one night (WBTB has its own). Most-used first. */
  techniques: Comparison[];
  wbtb: Comparison;
  /** Each band of minutes awake against nights without WBTB. */
  wbtbBands: Comparison[];
  /** Each band of hours asleep against the other nights whose length is known. */
  sleep: Comparison[];
  /** Naps against nights. */
  nap: Comparison;
  /** Each band of bedtime against the other nights whose bedtime is known. */
  bedtime: Comparison[];
}

/** "What works for you": every comparison over the logged nights given (pass the period's nights). */
export function whatWorks(nights: InsightNight[], dreams: InsightDream[], clock: Clock = localClock): WhatWorks {
  const ns = loggedNights(nights);
  const main = (n: InsightNight) => !n.nap;
  const used = new Map<string, number>();
  for (const n of ns) if (main(n)) for (const t of new Set(n.techniquesDone ?? [])) if (t !== "wbtb") used.set(t, (used.get(t) ?? 0) + 1);
  const techniques = [...used].sort((a, b) => b[1] - a[1]).map(([t]) => {
    const label = TECHNIQUES.find((x) => x.id === t)?.label ?? t;
    return compareLucid(ns, dreams, {
      id: `technique:${t}`, label, has: (n) => main(n) && !!n.techniquesDone?.includes(t), lacks: (n) => main(n) && !n.techniquesDone?.includes(t),
      withNoun: { one: `night with ${label}`, many: `nights with ${label}` }, withoutNoun: { one: `night without ${label}`, many: `nights without ${label}` },
    });
  });
  const noWbtb = (n: InsightNight) => main(n) && !isWbtb(n);
  const wbtb = compareLucid(ns, dreams, { id: "wbtb", label: "WBTB", has: (n) => main(n) && isWbtb(n), lacks: noWbtb, withNoun: nightsNoun("WBTB"), withoutNoun: OTHER });
  const wbtbBands = WBTB_BANDS.map((band) => compareLucid(ns, dreams, {
    id: `wbtb:${band.id}`, label: `Awake ${band.label}`,
    has: (n) => main(n) && isWbtb(n) && n.wbtbMinutesAwake != null && n.wbtbMinutesAwake >= band.lo && n.wbtbMinutesAwake < band.hi,
    lacks: noWbtb, withNoun: { one: `WBTB night awake ${band.label}`, many: `WBTB nights awake ${band.label}` }, withoutNoun: NO_WBTB,
  }));
  const banded = <B extends { id: string; label: string; lo: number; hi: number }>(prefix: string, bands: readonly B[], value: (n: InsightNight) => number | null, what: (b: B) => Noun) =>
    bands.map((band) => {
      const inBand = (n: InsightNight) => { const v = main(n) ? value(n) : null; return v != null && v >= band.lo && v < band.hi; };
      return compareLucid(ns, dreams, {
        id: `${prefix}:${band.id}`, label: band.label.charAt(0).toUpperCase() + band.label.slice(1), has: inBand,
        lacks: (n) => main(n) && value(n) != null && !inBand(n), withNoun: what(band), withoutNoun: OTHER,
      });
    });
  const sleep = banded("sleep", SLEEP_BANDS, sleepHours, (b) => ({ one: `night with ${b.label} sleep`, many: `nights with ${b.label} sleep` }));
  const bedtime = banded("bedtime", BEDTIME_BANDS, (n) => (n.bedtime ? afterNoon(clock.minutes(n.bedtime)) : null), (b) => ({ one: `night in bed ${b.label}`, many: `nights in bed ${b.label}` }));
  const nap = compareLucid(ns, dreams, { id: "nap", label: "Naps", has: (n) => !!n.nap, lacks: main, withNoun: { one: "nap", many: "naps" }, withoutNoun: { one: "night", many: "nights" } });
  return { techniques, wbtb, wbtbBands, sleep, nap, bedtime };
}
