// Rates and streaks (PLAN.md §7.3): pure sums over nights and dreams, used by Home, Insights, the course's
// move-on rules and the recommendations. Dates are the morning's YYYY-MM-DD; nothing here looks at the clock.

/** The night fields that tell a logged morning from a plan (rows from the engine; missing ones are unknown). */
export interface NightLog {
  dreamCount?: number; noRecall?: boolean;
  bedtime?: string | null; wakeTime?: string | null; sleepQuality?: number | null;
  wbtbUsed?: boolean; wbtbWakeAt?: string | null; wbtbMinutesAwake?: number | null;
  substances?: string | null; caffeineAfter?: string | null; alcohol?: boolean; notes?: string | null;
  techniquesDone?: string[];
}

/**
 * A night that holds only a plan (Train's "Use tonight": techniques planned, maybe an intention) and nothing about
 * the morning: no dream, no "No recall" mark, no night details. It is not a logged morning, so it stays out of
 * streaks, rates and the Journal until something is written. A row without the noRecall field (an older shape, a
 * test's bare date) is taken as logged: only a night known to lack the mark can be a plan.
 */
export function isPlanOnly(n: NightLog): boolean {
  if (n.noRecall !== false || (n.dreamCount ?? 0) > 0) return false;
  const set = (v: unknown) => v != null && v !== false && v !== "" && !(Array.isArray(v) && !v.length);
  return ![n.bedtime, n.wakeTime, n.sleepQuality, n.wbtbUsed, n.wbtbWakeAt, n.wbtbMinutesAwake, n.substances, n.caffeineAfter, n.alcohol, n.notes, n.techniquesDone].some(set);
}
/** The logged nights among nights: plans left out. */
export const loggedNights = <N extends NightLog>(nights: N[]): N[] => nights.filter((n) => !isPlanOnly(n));

/** Nights with at least one dream over logged nights (a night logged without recall still counts as logged; a plan does not). 0 with no nights. */
export function recallRate(nights: ({ dreamCount: number } & NightLog)[]): number {
  const logged = loggedNights(nights);
  if (!logged.length) return 0;
  return logged.filter((n) => n.dreamCount > 0).length / logged.length;
}

/** Lucid dreams per logged night, and the share of logged nights with a lucid dream. Dreams of other nights are ignored. */
export function lucidRate(all: ({ id: string } & NightLog)[], dreams: { nightId: string; lucid: boolean }[]): { perNight: number; nightShare: number } {
  const nights = loggedNights(all);
  if (!nights.length) return { perNight: 0, nightShare: 0 };
  const ids = new Set(nights.map((n) => n.id));
  const lucid = dreams.filter((d) => d.lucid && ids.has(d.nightId));
  return { perNight: lucid.length / nights.length, nightShare: new Set(lucid.map((d) => d.nightId)).size / nights.length };
}

/**
 * Consecutive mornings with a logged night, counted back from today. This morning not logged yet doesn't break
 * the streak (it's counted from yesterday), so the number holds until the day is over. A night that is only a plan
 * is not a logged morning.
 */
export function journalStreak(nights: ({ date: string } & NightLog)[], today: string): number {
  const logged = new Set(loggedNights(nights).map((n) => n.date));
  let day = logged.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (logged.has(day)) { n++; day = addDays(day, -1); }
  return n;
}

export function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
