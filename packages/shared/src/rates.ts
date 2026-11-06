// Rates and streaks (PLAN.md §7.3): pure sums over nights and dreams, used by Home, Insights, the course's
// move-on rules and the recommendations. Dates are the morning's YYYY-MM-DD; nothing here looks at the clock.

/** Nights with at least one dream over logged nights (a night logged without recall still counts as logged). 0 with no nights. */
export function recallRate(nights: { dreamCount: number }[]): number {
  if (!nights.length) return 0;
  return nights.filter((n) => n.dreamCount > 0).length / nights.length;
}

/** Lucid dreams per logged night, and the share of logged nights with a lucid dream. Dreams of other nights are ignored. */
export function lucidRate(nights: { id: string }[], dreams: { nightId: string; lucid: boolean }[]): { perNight: number; nightShare: number } {
  if (!nights.length) return { perNight: 0, nightShare: 0 };
  const ids = new Set(nights.map((n) => n.id));
  const lucid = dreams.filter((d) => d.lucid && ids.has(d.nightId));
  return { perNight: lucid.length / nights.length, nightShare: new Set(lucid.map((d) => d.nightId)).size / nights.length };
}

/**
 * Consecutive mornings with a logged night, counted back from today. This morning not logged yet doesn't break
 * the streak (it's counted from yesterday), so the number holds until the day is over.
 */
export function journalStreak(nights: { date: string }[], today: string): number {
  const logged = new Set(nights.map((n) => n.date));
  let day = logged.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (logged.has(day)) { n++; day = addDays(day, -1); }
  return n;
}

export function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
