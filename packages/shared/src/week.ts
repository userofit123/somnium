// The weekly review (LDJ-155): this week against last week, worked out on the device from what the journal and the
// checks already hold. The study protocols and the Lucidity Institute course run week by week (RESEARCH.md D5, D12,
// Part D 6.8), so a week is the rhythm to look back on. Pure: `today` and the clock are passed in. No dream text goes
// in or out: counts, technique labels and the name of one dream sign, which the screen shows like the Signs page does.
import { addDays } from "./rates";
import { periodSummary, type ReportInput } from "./report";
import { checksInsight, localClock, type Clock, type InsightCheck } from "./insights";

export interface WeekInput extends ReportInput { checks: readonly InsightCheck[] }

/** One week's numbers. */
export interface WeekSide {
  from: string; to: string;
  /** nights logged (a dream or "no recall"), naps left out */
  nights: number; dreams: number;
  /** dreams per logged night; null with no logged night */
  recall: number | null;
  lucid: number;
  /** nights with at least one lucid dream */
  lucidNights: number;
  checks: number; checksPerDay: number;
}
export interface WeekTechnique { id: string; label: string; nights: number; lucidNights: number }
/** A plain sentence and the RESEARCH.md reference ids behind any claim in it. */
export interface WeekNote { text: string; sources: string[] }
export interface WeekSummary {
  now: WeekSide; last: WeekSide;
  /** techniques done this week, most nights first */
  techniques: WeekTechnique[];
  /** the dream sign in most of this week's dreams (LaBerge targets the most frequent one [C1]) */
  topSign: { id: string; name: string; dreams: number } | null;
  /** 2-3 observations */
  notes: WeekNote[];
  /** the one recommendation */
  tip: WeekNote;
}

/** The evening before the week starts (Settings, Formats): Sunday for a Monday week, Saturday for a Sunday one. */
export const reviewWeekday = (firstDay: 0 | 1): number => (firstDay + 6) % 7;
/** The review is offered (Home's card) on the review day from 17:00 until midnight. */
export const REVIEW_HOUR = 17;
export function isReviewTime(today: string, hour: number, firstDay: 0 | 1): boolean {
  return new Date(today + "T12:00:00").getDay() === reviewWeekday(firstDay) && hour >= REVIEW_HOUR;
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const fmt1 = (x: number) => round1(x).toString();
const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

function side(inp: WeekInput, from: string, to: string, clock: Clock): WeekSide {
  const within = (d: string) => d >= from && d <= to;
  // periodSummary filters by a prefix; the empty prefix with the input already cut to the week sums the week
  const nights = inp.nights.filter((n) => within(n.date) && !n.nap), dreams = inp.dreams.filter((d) => within(d.date));
  const s = periodSummary("", { ...inp, nights, dreams });
  const lucidDays = new Set([...nights.filter((n) => (n.lucidCount ?? 0) > 0).map((n) => n.date), ...dreams.filter((d) => d.lucid && !d.deletedAt).map((d) => d.date)]);
  const c = checksInsight([...inp.checks], from, to, clock);
  return { from, to, nights: s.nightsLogged, dreams: s.dreams, recall: s.nightsLogged ? s.dreams / s.nightsLogged : null, lucid: s.lucid, lucidNights: lucidDays.size, checks: c.total, checksPerDay: round1(c.perDayAvg) };
}

/** This week is the 7 days ending `today` (on a Monday week's Sunday, exactly Monday to Sunday); last week the 7 before. */
export function weekSummary(inp: WeekInput, today: string, clock: Clock = localClock): WeekSummary {
  const from = addDays(today, -6);
  const now = side(inp, from, today, clock), last = side(inp, addDays(from, -7), addDays(from, -1), clock);
  const within = (d: string) => d >= from && d <= today;
  const nights = inp.nights.filter((n) => within(n.date) && !n.nap);
  const lucidDays = new Set([...nights.filter((n) => (n.lucidCount ?? 0) > 0).map((n) => n.date), ...inp.dreams.filter((d) => d.lucid && !d.deletedAt && within(d.date)).map((d) => d.date)]);
  const week = periodSummary("", { ...inp, nights: inp.nights.filter((n) => within(n.date)), dreams: inp.dreams.filter((d) => within(d.date)) }, 1);
  const techniques = week.techniques.map((t) => ({ ...t, lucidNights: nights.filter((n) => lucidDays.has(n.date) && (n.techniquesDone ?? []).includes(t.id)).length }))
    .sort((a, b) => b.lucidNights - a.lucidNights || b.nights - a.nights || a.label.localeCompare(b.label));
  const top = week.topSigns[0];
  const topSign = top ? { id: top.id, name: top.name, dreams: top.dreams } : null;
  return { now, last, techniques, topSign, notes: notes(now, last, techniques, topSign), tip: tip(now, techniques) };
}

function notes(now: WeekSide, last: WeekSide, techniques: WeekTechnique[], topSign: WeekSummary["topSign"]): WeekNote[] {
  const out: WeekNote[] = [];
  if (now.recall == null) out.push({ text: "No nights logged this week. A morning with nothing remembered still counts: log it as no recall.", sources: [] });
  else {
    const was = last.recall == null ? "" : round1(now.recall) === round1(last.recall) ? `, about the same as last week` : `, ${now.recall > last.recall ? "up" : "down"} from ${fmt1(last.recall)} last week`;
    out.push({ text: `You remembered ${fmt1(now.recall)} ${round1(now.recall) === 1 ? "dream" : "dreams"} a night over ${plural(now.nights, "logged night")}${was}.`, sources: [] });
  }
  const helped = techniques.filter((t) => t.lucidNights > 0).map((t) => t.label);
  if (now.lucidNights) out.push({ text: `Lucid on ${now.lucidNights} of ${plural(Math.max(now.nights, now.lucidNights), "night")}${helped.length ? `, with ${helped.join(" · ")}` : ""}. In the international study, people doing MILD or SSILD after WBTB were lucid on about 1 night in 6 [D12].`, sources: ["D12"] });
  else if (now.nights) out.push({ text: "No lucid dream this week. In the international study, even the best group was lucid on about 1 night in 5, so most weeks hold a few at most [D12].", sources: ["D12"] });
  if (topSign) out.push({ text: `${topSign.name} came up most, in ${plural(topSign.dreams, "dream")}. Targeting the sign that keeps coming back is LaBerge's dreamsign practice [C1].`, sources: ["C1"] });
  else if (now.checks || last.checks) out.push({ text: `${fmt1(now.checksPerDay)} reality checks a day (${fmt1(last.checksPerDay)} last week). The induction studies asked for 10 or more a day [D11][D12].`, sources: ["D11", "D12"] });
  return out.slice(0, 3);
}

function tip(now: WeekSide, techniques: WeekTechnique[]): WeekNote {
  if (now.nights < 4) return { text: "Log every morning next week, even when nothing comes back. Keeping the journal daily is what raises recall [C2].", sources: ["C2"] };
  if ((now.recall ?? 0) < 1) return { text: "Put recall first next week: lie still on waking and write before anything else. Better recall went with more lucid dreams in the international study [C2][D12].", sources: ["C2", "D12"] };
  const best = techniques.find((t) => t.lucidNights > 0);
  if (best) return { text: `Keep ${best.label} next week: it was part of your lucid nights. The course gives each technique at least a few weeks before judging it [D5].`, sources: ["D5"] };
  if (now.checksPerDay < 5) return { text: "Do more reality checks next week, around 10 a day, each one a real question. The induction studies asked for 10 or more [D11][D12].", sources: ["D11", "D12"] };
  return { text: "Keep the same plan another week. The studies and the course run a technique for at least a week before judging it [D5][D12].", sources: ["D5", "D12"] };
}
