// LDJ-177: when in the night you woke from your dreams. REM comes about every 90 minutes and the periods run longer
// late in the night (RESEARCH.md C31, C1), so the hours after bedtime a dream was woken from say when yours happen,
// and where an alarm (C1, C2) or WBTB (B39, D13) would catch them. A capture opened in the night stamps the moment;
// a dream written up later has none and is left out (it can't say when it happened).
import { clockOf } from "./journal";

type Times = { bedtime?: string | null; wakeTime?: string | null };

const MIN = 60_000, HOUR = 60 * MIN;
// how long after the logged wake time a capture still counts as waking from the night (getting up, finding the phone)
const AFTER_WAKE = HOUR;
// the longest a night can be: a bedtime further back than this is another night's
const LONGEST = 16 * HOUR;
// without a bedtime or wake time to go by, the night is these hours on the clock (a nap is not stamped)
const NIGHT_FROM = 20, NIGHT_TO = 11;

const ms = (iso: string | null | undefined) => { if (!iso) return null; const t = Date.parse(iso); return Number.isNaN(t) ? null : t; };

/**
 * The moment to keep as when you woke from a dream whose capture opens now, or null when now isn't in the night:
 * after the night's bedtime and before its wake time (with an hour's grace), or else the clock's night hours.
 */
export function wakeStamp(now: Date, night?: (Times & { nap?: boolean }) | null): string | null {
  if (night?.nap) return null;
  const t = now.getTime(), bed = ms(night?.bedtime), wake = ms(night?.wakeTime);
  if (bed != null && (t < bed || t - bed > LONGEST)) return null;
  if (wake != null && t > wake + AFTER_WAKE) return null;
  if (bed == null && wake == null) { const h = now.getHours(); if (h < NIGHT_FROM && h >= NIGHT_TO) return null; }
  return now.toISOString();
}

/** Minutes from bedtime to waking from the dream, or null when either is missing or it doesn't fit in one night. */
export function minutesAfterBedtime(wokeAt: string | null | undefined, bedtime: string | null | undefined): number | null {
  const w = ms(wokeAt), b = ms(bedtime);
  if (w == null || b == null || w < b || w - b > LONGEST) return null;
  return Math.round((w - b) / MIN);
}

const span = (m: number) => { const h = Math.floor(m / 60), r = m % 60; return h ? (r ? `${h} h ${r} min` : `${h} h`) : `${r} min`; };

/** The night page's line for a dream: "03:12 · 4 h 20 min after bedtime", or just the time without a bedtime. */
export function wakeFact(wokeAt: string | null | undefined, bedtime?: string | null): string | null {
  if (!ms(wokeAt)) return null;
  const m = minutesAfterBedtime(wokeAt, bedtime);
  return m == null ? clockOf(wokeAt) : `${clockOf(wokeAt)} · ${span(m)} after bedtime`;
}

export interface WakeRow { wokeAt?: string | null; bedtime?: string | null; lucid?: boolean }
export interface WakeHour { hour: number; dreams: number; lucid: number }

/** Timed dreams by the whole hour after bedtime they were woken from (0 = the first hour), in order, gaps included. */
export function wakeHours(rows: readonly WakeRow[]): WakeHour[] {
  const out: WakeHour[] = [];
  for (const r of rows) {
    const m = minutesAfterBedtime(r.wokeAt, r.bedtime);
    if (m == null) continue;
    const h = Math.floor(m / 60);
    while (out.length <= h) out.push({ hour: out.length, dreams: 0, lucid: 0 });
    const b = out[h]!;
    b.dreams++;
    if (r.lucid) b.lucid++;
  }
  return out;
}

// fewer timed dreams than this say nothing about a pattern
export const WAKE_PATTERN_MIN = 5;

/**
 * Where your dreams cluster: the middle (median) time after bedtime of your timed dreams, to the half hour, once
 * there are enough of them; for the WBTB alarm's suggestion ("your dreams cluster about 6 h after bedtime").
 */
export function wakeCluster(rows: readonly WakeRow[]): { minutes: number; dreams: number; label: string } | null {
  const m = rows.map((r) => minutesAfterBedtime(r.wokeAt, r.bedtime)).filter((x): x is number => x != null).sort((a, b) => a - b);
  if (m.length < WAKE_PATTERN_MIN) return null;
  const at = (i: number) => m[i]!, half = Math.floor(m.length / 2);
  const mid = m.length % 2 ? at(half) : (at(half - 1) + at(half)) / 2;
  const minutes = Math.round(mid / 30) * 30;
  return { minutes, dreams: m.length, label: `Your dreams cluster about ${span(minutes)} after bedtime` };
}
