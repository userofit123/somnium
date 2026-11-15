// Home (PLAN.md §6.1): the pure parts - which night is "last night" and which is tonight, the morning's summary,
// and the small progress strings. Dates are the morning's YYYY-MM-DD (a night is filed under the morning it ends
// in); the clock only comes in as an hour or a timestamp passed by the caller.
import { tonightOf } from "./course";
import { addDays, journalStreak, loggedNights, recallRate, type NightLog } from "./rates";
import { recallChangeText, recallProgress, type RecallBaseline } from "./insights";

/** The day turns over for the journal at 05:00, the same cut-off Train uses for tonight's plan. */
export const NIGHT_CUTOFF = 5;

export interface HomeNight { id: string; date: string; nap: boolean; dreamCount?: number; lucidCount?: number; noRecall?: boolean }
export interface HomeDream { id: string; nightId: string; date: string; lucid: boolean; nightmare?: boolean; title?: string | null; deletedAt?: string | null }

/**
 * Last night is the night filed under today's date at any hour: at 03:00 you write the dream you just woke from into
 * the night in progress, which is today's. Tonight is the night the coming morning is filed under - tomorrow from
 * 05:00, and before 05:00 the same night as last night (it is still going on).
 */
export function homeNights(today: string, hour: number): { lastNight: string; tonight: string; same: boolean } {
  const tonight = tonightOf(today, hour, NIGHT_CUTOFF);
  return { lastNight: today, tonight, same: tonight === today };
}

/**
 * The evening whose review and plan the hour belongs to: today's, or before the 05:00 turn yesterday's (at 01:00 you
 * are still in last evening's night, the same night homeNights calls tonight).
 */
export function eveningOf(today: string, hour: number): string {
  return hour < NIGHT_CUTOFF ? addDays(today, -1) : today;
}

export type MorningState =
  | { kind: "open" }
  | { kind: "noRecall" }
  | { kind: "logged"; dreams: number; lucid: number; nightmare: boolean; titled: { id: string; title: string }[] };

/**
 * What "This morning" shows for a date's night (not a nap): open until it has a dream or a "No recall" mark (a
 * night holding only tonight's plan or a few details is still open), then the summary. Titles only - Home never
 * shows dream text.
 */
export function morningState(nights: HomeNight[], dreams: HomeDream[], date: string): MorningState {
  const night = nights.find((n) => n.date === date && !n.nap);
  if (!night) return { kind: "open" };
  const mine = dreams.filter((d) => d.nightId === night.id && !d.deletedAt);
  if (mine.length) {
    return {
      kind: "logged", dreams: mine.length, lucid: mine.filter((d) => d.lucid).length,
      nightmare: mine.some((d) => !!d.nightmare),
      titled: mine.map((d) => ({ id: d.id, title: d.title?.trim() ?? "" })).filter((d) => d.title),
    };
  }
  return night.noRecall ? { kind: "noRecall" } : { kind: "open" };
}

const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

/** The one line under "This morning": "2 dreams · 1 lucid · a nightmare", or "No recall". Empty while open. */
export function morningLine(s: MorningState): string {
  if (s.kind === "open") return "";
  if (s.kind === "noRecall") return "No recall";
  const parts = [plural(s.dreams, "dream"), s.lucid ? (s.dreams === 1 ? "lucid" : `${s.lucid} lucid`) : "not lucid"];
  if (s.nightmare) parts.push("a nightmare");
  return parts.join(" · ");
}

/** The next reminder at or after `now` (timestamps), or null. */
export function nextReminder(times: number[], now: number): number | null {
  let best: number | null = null;
  for (const t of times) if (t >= now && (best === null || t < best)) best = t;
  return best;
}

/** How many of the given check times (as local dates) fall on `today`. */
export const checksOn = (days: string[], today: string): number => days.filter((d) => d === today).length;

export interface HomeRates {
  streak: number;
  /** Recall over the logged nights of the last `days` mornings (today included); plans are left out. */
  recall: { rate: number; withDreams: number; logged: number; days: number };
  /** Lucid dreams filed under a morning of this calendar month, naps' dreams included (insights.ts: a nap is not a
   *  night, its dreams are dreams). Read from the nights' own counts, so it never depends on how many dreams are loaded. */
  lucidThisMonth: number;
  /** "Your recall": dreams a night now against when you started (insights.ts recallProgress, the same line as
   *  Progress · Recall); "" until both sides have enough nights. Read from the nights' own counts. */
  recallChange: string;
}

/** `said` is the setup's recall answer (LDJ-180), the same starting point Progress · Recall uses. */
export function homeRates(nights: (HomeNight & NightLog)[], dreams: HomeDream[], today: string, days = 14, said: RecallBaseline | null = null): HomeRates {
  const from = addDays(today, -(days - 1));
  const inRange = nights.filter((n) => !n.nap && n.date >= from && n.date <= today).map((n) => ({ ...n, dreamCount: n.dreamCount ?? 0 }));
  const logged = loggedNights(inRange);
  const month = today.slice(0, 7);
  return {
    streak: journalStreak(nights.filter((n) => !n.nap), today),
    recall: { rate: recallRate(inRange), withDreams: logged.filter((n) => n.dreamCount > 0).length, logged: logged.length, days },
    lucidThisMonth: nights.length && nights.every((n) => n.lucidCount != null)
      ? nights.filter((n) => n.date.slice(0, 7) === month).reduce((a, n) => a + (n.lucidCount ?? 0), 0)
      : dreams.filter((d) => d.lucid && !d.deletedAt && d.date.slice(0, 7) === month).length,
    recallChange: recallChangeText(recallProgress(nights, [], today, said)),
  };
}

/** "64%" with the counts behind it: "7 of 11 logged nights". */
export function recallLine(r: HomeRates["recall"]): { value: string; sub: string } {
  if (!r.logged) return { value: "-", sub: `No logged nights in ${r.days} days` };
  return { value: `${Math.round(r.rate * 100)}%`, sub: `${r.withDreams} of ${plural(r.logged, "logged night")}` };
}

/** The most recent lucid dream (by its night's date, then its id, which grows with time), or null. */
export function lastLucid<D extends HomeDream>(dreams: D[]): D | null {
  let best: D | null = null;
  for (const d of dreams) if (d.lucid && !d.deletedAt && (!best || d.date > best.date || (d.date === best.date && d.id > best.id))) best = d;
  return best;
}

/** Which of `count` Learn articles is today's tip: a different one each day, the same all day long. */
export function tipIndex(date: string, count: number): number {
  if (count <= 0) return -1;
  let h = 2166136261;
  for (const c of date) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0) % count;
}

// ---------- a dream from your past (LDJ-161) ----------
// Re-reading old entries is how the dreamsign inventory is made: mark the signs in your reports, then count them
// (LaBerge and Rheingold 1990, Levitan and LaBerge 1995: RESEARCH.md C1 §1.3, C2), and MILD starts by recalling a
// dream and its sign (D1). So Home brings one back, preferring the ones that held a dream sign.
export const PAST_DREAM_SOURCES = ["C1", "C2", "D1"] as const;
/** Only dreams at least this old come back: last week's are still fresh, and the Journal lists them anyway. */
export const PAST_DREAM_MIN_DAYS = 7;

/** A dream sign one dream holds: the element's id and its (decrypted) name. */
export interface PastSign { id: string; name: string }
export interface PastDreamPick<D extends HomeDream> { dream: D; why: string }

/** The same day `months` months earlier, or null when that month has no such day (the 31st, 29 February). */
function monthsBack(ymd: string, months: number): string | null {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  const t = y * 12 + (m - 1) - months, yy = Math.floor(t / 12), mm = (t % 12) + 1;
  if (d > new Date(Date.UTC(yy, mm, 0)).getUTCDate()) return null;
  return `${String(yy).padStart(4, "0")}-${String(mm).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Today's dream from the past, the same one all day: a titled, live dream at least a week old (Home shows titles only,
 * never text). In order: one from a year or a month ago to the day; one that held this week's target sign; one that held
 * any dream sign; a past lucid dream; then any. Within a group the day picks (tipIndex), so it changes from day to day.
 * `signs` maps a dream id to the dream signs it held; `target` is the weekly review's target sign (an element id, "" for
 * none). `why` is the line under the title: why this one, never a word of the dream.
 */
export function pastDream<D extends HomeDream>(dreams: readonly D[], today: string, signs: ReadonlyMap<string, readonly PastSign[]> = new Map(), target = ""): PastDreamPick<D> | null {
  const before = addDays(today, -PAST_DREAM_MIN_DAYS);
  const pool = dreams.filter((d) => !d.deletedAt && d.title?.trim() && d.date <= before)
    .sort((a, b) => (a.date === b.date ? (a.id < b.id ? -1 : 1) : a.date < b.date ? -1 : 1));
  if (!pool.length) return null;
  const pick = (list: D[]) => list[tipIndex(today, list.length)]!;
  for (const [n, why] of [[12, "A year ago today"], [1, "A month ago today"]] as const) {
    const day = monthsBack(today, n), hit = day ? pool.filter((d) => d.date === day) : [];
    if (hit.length) return { dream: pick(hit), why };
  }
  const signOf = (d: D) => signs.get(d.id) ?? [];
  if (target) {
    const hit = pool.filter((d) => signOf(d).some((s) => s.id === target));
    if (hit.length) {
      const name = signOf(hit[0]!).find((s) => s.id === target)!.name;
      return { dream: pick(hit), why: name ? `Held this week's dream sign: ${name}` : "Held this week's dream sign" };
    }
  }
  const withSigns = pool.filter((d) => signOf(d).length);
  if (withSigns.length) {
    const d = pick(withSigns), names = signOf(d).map((s) => s.name).filter(Boolean);
    return { dream: d, why: names.length ? `Dream ${names.length === 1 ? "sign" : "signs"}: ${names.slice(0, 3).join(", ")}` : "Held a dream sign" };
  }
  const lucid = pool.filter((d) => d.lucid);
  if (lucid.length) return { dream: pick(lucid), why: "A lucid dream" };
  return { dream: pick(pool), why: "From your journal" };
}
