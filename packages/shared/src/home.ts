// Home (PLAN.md §6.1): the pure parts - which night is "last night" and which is tonight, the morning's summary,
// and the small progress strings. Dates are the morning's YYYY-MM-DD (a night is filed under the morning it ends
// in); the clock only comes in as an hour or a timestamp passed by the caller.
import { tonightOf } from "./course";
import { addDays, journalStreak, loggedNights, recallRate, type NightLog } from "./rates";

/** The day turns over for the journal at 05:00, the same cut-off Train uses for tonight's plan. */
export const NIGHT_CUTOFF = 5;

export interface HomeNight { id: string; date: string; nap: boolean; dreamCount?: number; noRecall?: boolean }
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

/** Reality checks done today against the plan: "3 of 6 checks", or "2 checks" with no plan (reminders off). */
export function checksLine(done: number, planned: number): string {
  if (planned > 0) return `${done} of ${planned} checks`;
  return done ? plural(done, "check") : "No checks yet";
}

/** Today's course practice: "1 of 3 done". Empty when the lesson has no practice items. */
export const practiceLine = (done: number, total: number): string => (total ? `${done} of ${total} done` : "");

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
  /** Lucid dreams filed under a morning of this calendar month. */
  lucidThisMonth: number;
}

export function homeRates(nights: (HomeNight & NightLog)[], dreams: HomeDream[], today: string, days = 14): HomeRates {
  const from = addDays(today, -(days - 1));
  const inRange = nights.filter((n) => !n.nap && n.date >= from && n.date <= today).map((n) => ({ ...n, dreamCount: n.dreamCount ?? 0 }));
  const logged = loggedNights(inRange);
  const month = today.slice(0, 7);
  return {
    streak: journalStreak(nights.filter((n) => !n.nap), today),
    recall: { rate: recallRate(inRange), withDreams: logged.filter((n) => n.dreamCount > 0).length, logged: logged.length, days },
    lucidThisMonth: dreams.filter((d) => d.lucid && !d.deletedAt && d.date.slice(0, 7) === month).length,
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
