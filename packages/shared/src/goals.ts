// Goals (PLAN.md §11, LDJ-41): one number each, read from the same rates Home and Insights show. Pure; today is passed in.
// Each kind fixes its own period, so the sheet only asks for the kind and the target.
import { journalStreak, loggedNights, type NightLog } from "./rates";
import { bucketOf } from "./insights";
import type { GoalKind, GoalPeriod } from "./types";

export const GOAL_KIND_INFO: Record<GoalKind, { label: string; period: GoalPeriod; unit: string; per: string; def: number; max: number }> = {
  recall_per_week: { label: "Nights with a dream, per week", period: "week", unit: "nights", per: "this week", def: 5, max: 7 },
  lucid_per_month: { label: "Lucid dreams, per month", period: "month", unit: "lucid dreams", per: "this month", def: 2, max: 60 },
  checks_per_day: { label: "Reality checks, per day", period: "day", unit: "checks", per: "today", def: 5, max: 100 },
  journal_streak: { label: "Journaling streak", period: "day", unit: "mornings in a row", per: "in a row", def: 7, max: 365 },
};

export interface GoalInput { id?: string; kind: GoalKind; target: number }
export interface GoalData {
  today: string;
  nights: (NightLog & { date: string; nap?: boolean; dreamCount?: number; lucidCount?: number })[];
  /** local dates (YYYY-MM-DD) of the reality checks done, one entry per check */
  checkDays: string[];
}
export interface GoalProgress { value: number; target: number; unit: string; per: string; done: boolean; ratio: number; line: string }

export function goalProgress(g: GoalInput, d: GoalData): GoalProgress {
  const info = GOAL_KINDS_INFO(g.kind);
  const real = d.nights.filter((n) => !n.nap);
  let value = 0;
  if (g.kind === "recall_per_week") {
    const from = bucketOf(d.today, "week");
    value = loggedNights(real.filter((n) => n.date >= from && n.date <= d.today)).filter((n) => (n.dreamCount ?? 0) > 0).length;
  } else if (g.kind === "lucid_per_month") {
    const m = d.today.slice(0, 7);
    value = d.nights.filter((n) => n.date.slice(0, 7) === m).reduce((a, n) => a + (n.lucidCount ?? 0), 0);
  } else if (g.kind === "checks_per_day") {
    value = d.checkDays.filter((x) => x === d.today).length;
  } else {
    value = journalStreak(real.map((n) => ({ ...n, dreamCount: n.dreamCount ?? 0 })), d.today);
  }
  const done = value >= g.target;
  return { value, target: g.target, unit: info.unit, per: info.per, done, ratio: Math.min(1, value / Math.max(1, g.target)), line: `${value} of ${g.target} ${info.unit} ${info.per}` };
}
const GOAL_KINDS_INFO = (k: GoalKind) => GOAL_KIND_INFO[k];

/** Days left in the goal's period, for a gentle "n days left" (week and month goals only). */
export function periodDaysLeft(kind: GoalKind, today: string): number | null {
  if (kind === "recall_per_week") return 6 - ((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7);
  if (kind === "lucid_per_month") { const [y, m] = today.split("-").map(Number) as [number, number]; return new Date(Date.UTC(y, m, 0)).getUTCDate() - Number(today.slice(8)); }
  return null;
}
