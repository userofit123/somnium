// Insights (PLAN.md §6.5): pure sums over logged nights, their dreams and the reality checks, computed on the device.
// Plans (a night with only techniques planned) are left out everywhere, as in rates.ts.
// Naps, one rule everywhere (Home too, home.ts): a nap is not a night, so every count of nights (nights logged, nights
// with recall, lucid nights, dreams a night, the "what works" groups) leaves it out; its dreams are still dreams, so
// every count of dreams (lucid dreams, levels, nightmares, feelings) takes them in. Dates are the morning's
// YYYY-MM-DD; times of day (bedtime, a check's moment) are read through `clock`, so tests don't depend on the zone.
//
// "What works for you" (LDJ-22) compares lucid nights on nights with something against nights without. It never
// shows a rate when either group has fewer than MIN_NIGHTS nights, gives both sample sizes, and says "went with",
// never "caused": these are the person's own nights, not an experiment. The recommendation rules (PLAN.md §8.2,
// LDJ-27) read the same Comparison objects, so the threshold and wording stay in one place.
import { loggedNights, addDays, minutesToSleep, type NightLog } from "./rates";
import { TECHNIQUES } from "./journal";
import { lucidSplit, type SignDream, type SignLink } from "./signs";
import { BECAME_LUCID_HOW, CHECK_KINDS, CHECK_OUTCOMES, type BecameLucidHow, type CheckKind, type CheckOutcome } from "./types";

/** Fewer nights than this in either group: "not enough nights yet", and no rate. */
export const MIN_NIGHTS = 10;

export interface InsightNight extends NightLog {
  id: string;
  date: string;
  nap?: boolean;
  /** lucid dreams in the night, as the engine counts them (GET /nights): when given, a lucid night needs no dream list */
  lucidCount?: number;
}
export interface InsightDream {
  /** the dream's id, when known: early results link a lucid night to its dream */
  id?: string;
  nightId: string;
  lucid: boolean;
  lucidityLevel?: number | null;
  emotionOverall?: number | null;
  nightmare?: boolean;
  badDream?: boolean;
  falseAwakening?: boolean;
  sleepParalysis?: boolean;
  becameLucidHow?: BecameLucidHow | null;
}
export interface InsightCheck { at: string; kind: CheckKind; outcome: CheckOutcome; prompted: boolean; /** the dream sign (element id) the reminder paired it with (LDJ-111) */ signId?: string | null }

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
  /** dreams is of the nights only (it is "dreams a night"); napDreams are the naps' dreams beside them */
  nights: number; withRecall: number; dreams: number; napDreams: number;
  byBucket: RecallRow[];
  /** Monday first. */
  byWeekday: RecallRow[];
}
/**
 * Dreams by morning: one entry per date, so two logs on one date (a night saved twice before the replica merged
 * them) are one night with both logs' dreams. Naps and plans are left out. A night's dreams come from the dream list
 * when it has any there, else from its own count.
 */
function mornings(nights: InsightNight[], dreams: InsightDream[], from: string | null, to: string): Map<string, number> {
  const ns = nightsIn(nights, from, to).filter((n) => !n.nap);
  const count = new Map<string, number>();
  for (const d of dreamsOf(ns, dreams)) count.set(d.nightId, (count.get(d.nightId) ?? 0) + 1);
  const byDate = new Map<string, number>();
  for (const n of ns) byDate.set(n.date, (byDate.get(n.date) ?? 0) + (count.get(n.id) ?? n.dreamCount ?? 0));
  return byDate;
}

/** Dreams per night and nights with recall, by week (or month) and by weekday of the morning. Naps aren't nights; their dreams are counted apart. */
export function recallInsight(nights: InsightNight[], dreams: InsightDream[], from: string | null, to: string, b: Bucket = "week"): RecallInsight {
  const all = nightsIn(nights, from, to);
  const byDate = mornings(nights, dreams, from, to);
  const row = (key: string): RecallRow => ({ key, nights: 0, withRecall: 0, dreams: 0 });
  const add = (r: RecallRow, dc: number) => { r.nights++; r.dreams += dc; if (dc > 0) r.withRecall++; };
  const { first, last } = span([...byDate.keys()].map((date) => ({ date })), from, to);
  const buckets = new Map(byDate.size ? bucketRange(first, last, b).map((k) => [k, row(k)]) : []);
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(row);
  const total = row("all");
  for (const [date, dc] of byDate) { add(total, dc); add(buckets.get(bucketOf(date, b)) ?? row(""), dc); add(days[weekday(date)]!, dc); }
  const napDreams = dreamsOf(all.filter((n) => n.nap), dreams).length;
  return { nights: total.nights, withRecall: total.withRecall, dreams: total.dreams, napDreams, byBucket: [...buckets.values()], byWeekday: days };
}

// ---------- recall progress (LDJ-113) ----------
// "Are you remembering more than when you started?" Dreams a night over the last two weeks against a starting point:
// the person's own answer from the first-run setup when there is one (LDJ-180 will store it), otherwise the first 14
// logged nights of the journal (before the last two weeks, so the two never share a night). Neither side is compared
// until it has RECALL_MIN_NIGHTS nights: one or two nights say nothing. Always since the start, whatever period the page shows. The course's two recall targets are
// 1 dream a night for 7 nights in a row, then 2 a night (RESEARCH.md C2, D5). Part of any rise is the journal itself:
// keeping one makes people remember and report more dreams (the logbook enhancement effect, B48, C30, C30a), so the
// page says so; recall still matters, since better recall predicted induction success (B38).

/** Nights in each of the two windows compared: the last two weeks and the first two. */
export const RECALL_WINDOW = 14;
export const RECALL_TARGETS = { run: 7, perNight: 2 } as const;
/** Fewer logged nights than this in a window: no comparison, and no "2 a night" reached. */
export const RECALL_MIN_NIGHTS = 7;
export const RECALL_COUNTING_SOURCES = ["B48", "C30", "C30a"] as const;
export const RECALL_TARGET_SOURCES = ["C2", "D5"] as const;
export const RECALL_WHY_SOURCES = ["B38"] as const;
/** The course puts recall first. */
export const RECALL_FIRST_SOURCES = ["D5"] as const;
/** The setup answer (LDJ-180): roughly how many dreams a night, and the person's own words for it. */
export interface RecallBaseline { perNight: number; label: string }
export interface RecallSpan { nights: number; dreams: number; perNight: number | null }
export interface RecallProgress {
  /** the 14 mornings up to today */
  now: RecallSpan;
  /** the first 14 logged nights before the last two weeks began; null while there are fewer than RECALL_MIN_NIGHTS */
  start: (RecallSpan & { from: string; to: string }) | null;
  /** the setup answer, when one is stored */
  said: RecallBaseline | null;
  /** what "now" is set against: the setup answer when there is one, else the first 14 logged nights; null when neither */
  base: { perNight: number; from: "setup" | "journal" } | null;
  /** nights in a row with a dream, ending at the latest logged night (0 when that is older than yesterday), and the best run */
  run: number; bestRun: number;
  /** the course targets reached: 7 nights in a row with a dream (ever), 2 a night over the last two weeks (RECALL_MIN_NIGHTS+ nights logged) */
  reached: { run: boolean; twoANight: boolean };
  /** dreams a night by week since the first night (weeks with no night logged have nights 0) */
  weekly: RecallRow[];
}

export function recallProgress(nights: InsightNight[], dreams: InsightDream[], today: string, said: RecallBaseline | null = null): RecallProgress {
  const byDate = mornings(nights, dreams, null, today);
  const dates = [...byDate.keys()].sort();
  const spanOf = (ds: string[]): RecallSpan => {
    const sum = ds.reduce((s, d) => s + byDate.get(d)!, 0);
    return { nights: ds.length, dreams: sum, perNight: ds.length ? sum / ds.length : null };
  };
  const nowFrom = addDays(today, -(RECALL_WINDOW - 1));
  const now = spanOf(dates.filter((d) => d >= nowFrom));
  const first = dates[0];
  // the first 14 logged nights, counted only from those before the last two weeks so the two never share a night
  const early = dates.filter((d) => d < nowFrom).slice(0, RECALL_WINDOW);
  const start = early.length >= RECALL_MIN_NIGHTS ? { ...spanOf(early), from: early[0]!, to: early.at(-1)! } : null;
  const base = said ? { perNight: said.perNight, from: "setup" as const } : start?.perNight != null ? { perNight: start.perNight, from: "journal" as const } : null;
  let run = 0, bestRun = 0, prev: string | null = null;
  for (const d of dates) {
    const hit = byDate.get(d)! > 0;
    run = hit ? (prev && addDays(prev, 1) === d ? run + 1 : 1) : 0;
    prev = hit ? d : null;
    bestRun = Math.max(bestRun, run);
  }
  const last = dates.at(-1);
  if (!last || last < addDays(today, -1) || !byDate.get(last)) run = 0;
  return {
    now, start, said, base, run, bestRun,
    reached: { run: bestRun >= RECALL_TARGETS.run, twoANight: now.nights >= RECALL_MIN_NIGHTS && (now.perNight ?? 0) >= RECALL_TARGETS.perNight },
    weekly: first ? recallInsight(nights, dreams, first, today, "week").byBucket : [],
  };
}

/** One plain line: "Up from 0.3 to 1.2 dreams a night", "About the same as ...", or "" with nothing to compare
 *  (no starting point, or fewer than RECALL_MIN_NIGHTS nights in the last two weeks). */
export function recallChangeText(p: Pick<RecallProgress, "now" | "base">): string {
  if (p.now.perNight == null || p.now.nights < RECALL_MIN_NIGHTS || !p.base) return "";
  const r = (v: number) => (Math.round(v * 10) / 10).toString();
  const a = r(p.base.perNight), b = r(p.now.perNight);
  const since = p.base.from === "setup" ? "what you said at the start" : "your first logged nights";
  const unit = `dream${b === "1" ? "" : "s"} a night`;
  if (a === b) return `About the same as ${since}: ${b} ${unit}`;
  return `${p.now.perNight > p.base.perNight ? "Up" : "Down"} from ${a} to ${b} ${unit}, against ${since}`;
}

// ---------- lucidity ----------

export interface LucidityInsight {
  /** lucid and dreams count nap dreams too; lucidNights and nights are nights only */
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
  const main = new Set(ns.filter((n) => !n.nap).map((n) => n.id));
  return { lucid: lucid.length, dreams: ds.length, lucidNights: new Set(lucid.filter((d) => main.has(d.nightId)).map((d) => d.nightId)).size, nights: main.size, byBucket: [...buckets.values()], levels, how: how.filter((h) => h.count > 0) };
}

// ---------- night events and emotions ----------

export interface EventRow { key: string; nightmares: number; badDreams: number; falseAwakenings: number; sleepParalysis: number }
/**
 * Nightmares, bad dreams, false awakenings and sleep paralysis: counts of dreams, so naps' dreams are in. Nightmares
 * (they woke you) apart from bad dreams (they didn't), counted from the log rather than from memory: it is nightmare
 * frequency that goes with poorer well-being, and logs find more of both than estimates do (RESEARCH.md C18).
 */
export function eventsInsight(nights: InsightNight[], dreams: InsightDream[], from: string | null, to: string, b: Bucket = "month"): { total: Omit<EventRow, "key">; byBucket: EventRow[] } {
  const ns = nightsIn(nights, from, to);
  const { first, last } = span(ns, from, to);
  const buckets = new Map(ns.length ? bucketRange(first, last, b).map((k) => [k, { key: k, nightmares: 0, badDreams: 0, falseAwakenings: 0, sleepParalysis: 0 }]) : []);
  const total = { nightmares: 0, badDreams: 0, falseAwakenings: 0, sleepParalysis: 0 };
  for (const d of dreamsOf(ns, dreams)) {
    const r = buckets.get(bucketOf(d.date, b));
    for (const [k, on] of [["nightmares", d.nightmare], ["badDreams", !d.nightmare && d.badDream], ["falseAwakenings", d.falseAwakening], ["sleepParalysis", d.sleepParalysis]] as const) {
      if (!on) continue;
      total[k]++;
      if (r) r[k]++;
    }
  }
  return { total, byBucket: [...buckets.values()] };
}

export interface EmotionRow { key: string; rated: number; avg: number | null; pleasant: number; neutral: number; unpleasant: number }
/** The overall feeling of the dreams (naps' dreams too) (-2..2) per bucket: its average and how many were pleasant, neutral or unpleasant. */
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

export interface SignCheckRow {
  elementId: string; checks: number; dreaming: number;
  /** lucid dreams marked as started by noticing a dream sign, among the dreams with this sign (signs.ts lucidSplit) */
  lucidViaSign: number;
}
/**
 * Checks per paired dream sign (LDJ-200): how many were paired with each sign in the range, how many of those said
 * "dreaming", and the lucid dreams that came from noticing it. Only ids here: the names are sealed and the screen adds
 * them from the unlocked elements. Most checks first, then the sign with more lucid dreams; `unpaired` are the rest.
 */
export function checksBySign(checks: readonly InsightCheck[], links: readonly SignLink[], dreams: readonly SignDream[], from: string | null, to: string, clock: Clock = localClock): { rows: SignCheckRow[]; unpaired: number } {
  const by = new Map<string, SignCheckRow>();
  let unpaired = 0;
  for (const c of checks) {
    const day = clock.day(c.at);
    if ((from != null && day < from) || day > to) continue;
    if (!c.signId) { unpaired++; continue; }
    const r = by.get(c.signId) ?? { elementId: c.signId, checks: 0, dreaming: 0, lucidViaSign: 0 };
    r.checks++; if (c.outcome === "dreaming") r.dreaming++;
    by.set(c.signId, r);
  }
  for (const r of by.values()) r.lucidViaSign = lucidSplit(r.elementId, links, dreams).with.viaSign;
  return { rows: [...by.values()].sort((a, b) => b.checks - a.checks || b.lucidViaSign - a.lucidViaSign || a.elementId.localeCompare(b.elementId)), unpaired };
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
  return `On your ${plural(a.nights, a.noun)} you were lucid on ${a.lucid} (${pct(a.rate!)}); on your ${plural(b.nights, b.noun)}, you were lucid on ${b.lucid} (${pct(b.rate!)}).`;
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
  for (const n of ns) if ((n.lucidCount ?? 0) > 0) lucidNights.add(n.id);
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
/**
 * Minutes after noon, so that evening and after-midnight bedtimes sort in order (22:00 is 600, 01:00 is 780).
 * The bedtime is read on this device's clock (localClock) as it is now: nights logged in another time zone, or across a
 * daylight saving change, land in the band of the zone the device is in today, not the one the person slept in.
 */
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
  /** Asleep within ASLEEP_WITHIN minutes of the technique against longer, over the nights where it was logged. */
  asleep: Comparison;
}

/** The cut-off that predicted success in the largest MILD study: asleep within 10 minutes of the technique, 18.3% of
 *  nights lucid against 11.1% (RESEARCH.md B38; the 5-minute cut-off was not significant there). */
export const ASLEEP_WITHIN = 10;

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
  const asleepIn = (n: InsightNight) => (main(n) ? minutesToSleep(n) : null);
  const asleep = compareLucid(ns, dreams, {
    id: "asleep", label: `Asleep within ${ASLEEP_WITHIN} min of the technique`,
    has: (n) => { const m = asleepIn(n); return m != null && m <= ASLEEP_WITHIN; },
    lacks: (n) => { const m = asleepIn(n); return m != null && m > ASLEEP_WITHIN; },
    withNoun: { one: `night asleep within ${ASLEEP_WITHIN} min`, many: `nights asleep within ${ASLEEP_WITHIN} min` },
    withoutNoun: { one: `night it took more than ${ASLEEP_WITHIN} min to fall asleep`, many: `nights it took more than ${ASLEEP_WITHIN} min to fall asleep` },
  });
  return { techniques, wbtb, wbtbBands, sleep, nap, bedtime, asleep };
}

// ---------- early results per technique (LDJ-109) ----------
// The rates above wait for MIN_NIGHTS on each side, which takes weeks for WBTB or SSILD. Until then the person still
// sees what their own lucid nights came after, as plain counts ("3 lucid nights of 8 tried"), never a rate, and labelled
// early: a few nights swing either way by chance (RESEARCH.md Part C §5.2), and even the best techniques gave a lucid
// dream on about 1 night in 6 in the largest study (B38), so 0 of 2 says little. Same wording rule: "came after",
// "went with", never "caused".

/** Sources for the early-numbers note: small samples mislead (C12a, §5.2); lucid nights are rare even with the best techniques (B38). */
export const EARLY_SOURCES = ["C12a", "B38"] as const;

/** One logged night with what was done before it, in one line: "WBTB 45 min · MILD · asleep in 5 min · in bed 23:10". */
export interface NightRecipe {
  id: string;
  date: string;
  nap: boolean;
  /** lucid dreams in the night */
  lucid: number;
  /** the first lucid dream's id, when the dreams carry ids */
  dreamId: string | null;
  /** technique ids done, WBTB included when logged as wbtbUsed; in TECHNIQUES order */
  techniques: string[];
  parts: string[];
  /** the parts joined with " · ", or "Nothing logged before it" */
  text: string;
}

const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

function lucidByNight(ns: InsightNight[], dreams: InsightDream[]): Map<string, { count: number; dreamId: string | null }> {
  const ids = new Set(ns.map((n) => n.id));
  const by = new Map<string, { count: number; dreamId: string | null }>();
  for (const d of dreams) {
    if (!d.lucid || !ids.has(d.nightId)) continue;
    const e = by.get(d.nightId) ?? { count: 0, dreamId: null };
    e.count++; e.dreamId ??= d.id ?? null;
    by.set(d.nightId, e);
  }
  // the engine's count stands in when the night's dreams are not in the list given
  for (const n of ns) if ((n.lucidCount ?? 0) > (by.get(n.id)?.count ?? 0)) by.set(n.id, { count: n.lucidCount!, dreamId: by.get(n.id)?.dreamId ?? null });
  return by;
}

const techniquesOf = (n: InsightNight): string[] => {
  const done = new Set(n.techniquesDone ?? []);
  if (isWbtb(n)) done.add("wbtb");
  const order = TECHNIQUES.map((t) => t.id);
  return [...done].sort((a, b) => (order.indexOf(a) + 1 || 999) - (order.indexOf(b) + 1 || 999));
};

/** One night's recipe. `lucid` and `dreamId` come from the caller (see lucidRecipes / techniqueTally). */
function recipeOf(n: InsightNight, lucid: number, dreamId: string | null, clock: Clock): NightRecipe {
  const techniques = techniquesOf(n);
  const parts: string[] = [];
  if (techniques.includes("wbtb")) parts.push(n.wbtbMinutesAwake != null ? `WBTB ${n.wbtbMinutesAwake} min` : "WBTB");
  for (const t of techniques) if (t !== "wbtb") parts.push(TECHNIQUES.find((x) => x.id === t)?.label ?? t);
  const m = minutesToSleep(n);
  if (m != null) parts.push(`asleep in ${m} min`);
  if (n.bedtime) parts.push(`in bed ${hhmm(clock.minutes(n.bedtime))}`);
  return { id: n.id, date: n.date, nap: !!n.nap, lucid, dreamId, techniques, parts, text: parts.length ? parts.join(" · ") : "Nothing logged before it" };
}

/** Every logged night with a lucid dream (naps too: a lucid nap is still one), newest first, with what came before it. */
export function lucidRecipes(nights: InsightNight[], dreams: InsightDream[], clock: Clock = localClock): NightRecipe[] {
  const ns = loggedNights(nights);
  const by = lucidByNight(ns, dreams);
  return ns.filter((n) => by.has(n.id))
    .map((n) => recipeOf(n, by.get(n.id)!.count, by.get(n.id)!.dreamId, clock))
    .sort((a, b) => (a.date === b.date ? Number(a.nap) - Number(b.nap) : b.date.localeCompare(a.date)));
}

export interface TechniqueTally {
  /** technique id, "wbtb" included */
  id: string;
  label: string;
  /** nights (naps left out, as in the rates) the technique was done */
  nights: number;
  /** of those, nights with a lucid dream */
  lucid: number;
  /** fewer than MIN_NIGHTS nights with it: counts only, no rate */
  early: boolean;
  /** "3 lucid nights of 8 tried" */
  text: string;
  /** the nights it was done, newest first */
  list: NightRecipe[];
}

/** The plain count of each technique tried: nights done and how many were lucid, most tried first. */
export function techniqueTally(nights: InsightNight[], dreams: InsightDream[], clock: Clock = localClock): TechniqueTally[] {
  const ns = loggedNights(nights).filter((n) => !n.nap);
  const by = lucidByNight(ns, dreams);
  const tally = new Map<string, NightRecipe[]>();
  for (const n of ns) {
    const r = recipeOf(n, by.get(n.id)?.count ?? 0, by.get(n.id)?.dreamId ?? null, clock);
    for (const t of r.techniques) tally.set(t, [...(tally.get(t) ?? []), r]);
  }
  return [...tally].map(([id, list]) => {
    const lucid = list.filter((r) => r.lucid > 0).length;
    return {
      id, label: TECHNIQUES.find((x) => x.id === id)?.label ?? id, nights: list.length, lucid, early: list.length < MIN_NIGHTS,
      text: `${lucid} lucid ${lucid === 1 ? "night" : "nights"} of ${list.length} tried`,
      list: list.sort((a, b) => b.date.localeCompare(a.date)),
    };
  }).sort((a, b) => b.nights - a.nights || b.lucid - a.lucid || a.label.localeCompare(b.label));
}
