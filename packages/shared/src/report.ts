// Month report and year in review (PLAN.md §11, LDJ-41): counts over one month or year, computed on the device from the
// nights, dreams and elements it already holds. No dream text goes in: the only words are element names and one dream
// title for the best night, which the page shows on screen and in print the way the Journal shows them.
import { loggedNights, recallRate, type NightLog } from "./rates";
import { TECHNIQUES } from "./journal";
import { elementStats, type SignDream, type SignElement, type SignLink } from "./signs";

export interface ReportNight extends NightLog { id: string; date: string; nap?: boolean; lucidCount?: number }
export interface ReportDream extends SignDream { nightId?: string; title?: string | null; lucidityLevel?: number | null; vividness?: number | null; deletedAt?: string | null }
export interface ReportInput { nights: ReportNight[]; dreams: ReportDream[]; elements: SignElement[]; links: SignLink[] }

export interface MonthSummary {
  period: string; // YYYY-MM or YYYY
  dreams: number;
  nightsLogged: number;
  nightsWithRecall: number;
  /** null with no logged night */
  recallRate: number | null;
  lucid: number;
  topSigns: { name: string; dreams: number }[];
  /** elements whose first dream is in the period */
  newElements: { name: string; kind: string }[];
  newElementCount: number;
  techniques: { id: string; label: string; nights: number }[];
  /** the dream with the highest lucidity, then vividness; its title is shown only when it has one */
  best: { date: string; title: string | null; lucidityLevel: number | null; lucid: boolean } | null;
}

const inPeriod = (date: string, p: string) => date.startsWith(p);

export function periodSummary(period: string, inp: ReportInput, topN = 5): MonthSummary {
  const nights = inp.nights.filter((n) => inPeriod(n.date, period));
  const real = nights.filter((n) => !n.nap);
  const logged = loggedNights(real.map((n) => ({ ...n, dreamCount: n.dreamCount ?? 0 })));
  const dreams = inp.dreams.filter((d) => !d.deletedAt && inPeriod(d.date, period));
  const lucid = nights.some((n) => n.lucidCount != null) ? nights.reduce((a, n) => a + (n.lucidCount ?? 0), 0) : dreams.filter((d) => d.lucid).length;
  const byId = new Map(inp.elements.map((e) => [e.id, e]));
  const live = inp.dreams.filter((d) => !d.deletedAt);
  const stats = elementStats(inp.elements, inp.links, live, period.length === 4 ? `${period}-12-31` : `${period}-28`);
  const inDreams = new Set(dreams.map((d) => d.id));
  const counts = new Map<string, number>();
  for (const l of inp.links) if (inDreams.has(l.dreamId)) counts.set(l.elementId, (counts.get(l.elementId) ?? 0) + 1);
  const topSigns = [...counts].map(([id, n]) => ({ e: byId.get(id), n })).filter((x): x is { e: SignElement; n: number } => !!x.e?.name && (x.e.isDreamSign || x.e.signCategory != null || x.e.kind === "dream_sign"))
    .sort((a, b) => b.n - a.n || a.e.name!.localeCompare(b.e.name!)).slice(0, topN).map((x) => ({ name: x.e.name!, dreams: x.n }));
  const fresh = inp.elements.filter((e) => e.name && stats.get(e.id)?.firstSeen && inPeriod(stats.get(e.id)!.firstSeen!, period));
  const tech = new Map<string, number>();
  for (const n of real) for (const t of new Set(n.techniquesDone ?? [])) tech.set(t, (tech.get(t) ?? 0) + 1);
  const label = new Map(TECHNIQUES.map((t) => [t.id, t.label]));
  const score = (d: ReportDream) => (d.lucid ? 100 : 0) + (d.lucidityLevel ?? 0) * 10 + (d.vividness ?? 0);
  const top = [...dreams].sort((a, b) => score(b) - score(a) || a.date.localeCompare(b.date))[0];
  return {
    period, dreams: dreams.length, nightsLogged: logged.length, nightsWithRecall: logged.filter((n) => n.dreamCount > 0).length,
    recallRate: logged.length ? recallRate(logged) : null, lucid,
    topSigns, newElements: fresh.slice(0, 8).map((e) => ({ name: e.name!, kind: e.kind })), newElementCount: fresh.length,
    techniques: [...tech].map(([id, nights]) => ({ id, label: label.get(id) ?? id, nights })).sort((a, b) => b.nights - a.nights),
    best: top ? { date: top.date, title: top.title?.trim() || null, lucidityLevel: top.lucidityLevel ?? null, lucid: top.lucid } : null,
  };
}

export const monthSummary = periodSummary;
export interface YearSummary extends MonthSummary { months: { month: string; dreams: number; lucid: number; recallRate: number | null }[]; bestMonth: string | null }
export function yearSummary(year: string, inp: ReportInput): YearSummary {
  const s = periodSummary(year, inp, 8);
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`).map((m) => {
    const x = periodSummary(m, inp);
    return { month: m, dreams: x.dreams, lucid: x.lucid, recallRate: x.recallRate };
  });
  const best = [...months].sort((a, b) => b.dreams - a.dreams)[0];
  return { ...s, months, bestMonth: best && best.dreams > 0 ? best.month : null };
}

/** The months and years that hold any night, newest first, for the pickers. */
export function reportPeriods(nights: { date: string }[]): { months: string[]; years: string[] } {
  const months = [...new Set(nights.map((n) => n.date.slice(0, 7)))].sort().reverse();
  return { months, years: [...new Set(months.map((m) => m.slice(0, 4)))] };
}
export const monthName = (ym: string) => new Date(`${ym}-15T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
