// The course's "ready to move on" rules (PLAN.md §8.1, LDJ-24): pure functions over the person's own data, one per
// lesson. Each says how far along you are ("3 of 4 dreams this week") and why the rule is what it is. The rule never
// blocks: moving on by choice is always allowed (the screen offers it), so these only tell you when it makes sense.
// Dates are local YYYY-MM-DD; nothing here looks at the clock, `today` is passed in.
import { addDays, journalStreak } from "./rates";

export const COURSE_LESSONS = ["recall", "journal-habits", "reality-checks", "mild-wbtb", "stabilise", "ssild-wild", "dream-control", "troubleshooting"] as const;
export type CourseLesson = (typeof COURSE_LESSONS)[number];

export interface CourseData {
  today: string;
  /** The day this lesson became the current one (its course_progress row). Missing: today. */
  since?: string;
  /** Logged nights (a night's date is the morning's) with their dream and lucid counts. */
  nights: { date: string; dreamCount: number; lucidCount: number; techniquesPlanned?: string[]; techniquesDone?: string[] }[];
  /** The local date of each reality check. */
  checkDays: string[];
  /** Practice ticks: item ids and the date they were ticked. */
  practice: { date: string; item: string; done: boolean }[];
  /** The lesson's practice item ids (for the "tick each once" rule). */
  items?: string[];
}

export interface MoveOn {
  ready: boolean;
  /** Where you are, in a few words: "3 of 4 dreams this week". */
  progress: string;
  /** Why the rule is what it is, in plain words. */
  reason: string;
  /** 0-1, for a progress bar. */
  share: number;
}

const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;
/** Whole days from a to b (b later). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86_400_000);
}
const past = (d: CourseData) => d.nights.filter((n) => n.date <= d.today);
const sinceStart = (d: CourseData) => past(d).filter((n) => n.date >= (d.since ?? d.today));
const share = (n: number, of: number) => Math.max(0, Math.min(1, of ? n / of : 1));

/** "N lucid dreams since you started, or 4 weeks": the shape of the later lessons' rules. */
function lucidOrWeeks(d: CourseData, need: number, weeks: number, reason: string): MoveOn {
  const lucid = sinceStart(d).reduce((s, n) => s + n.lucidCount, 0);
  const day = daysBetween(d.since ?? d.today, d.today) + 1;
  const total = weeks * 7;
  const ready = lucid >= need || day > total;
  const what = need === 1 ? (lucid ? "a lucid dream" : "no lucid dream yet") : `${Math.min(lucid, need)} of ${need} lucid dreams`;
  return { ready, progress: `Day ${Math.min(day, total)} of ${total} · ${what}`, reason, share: Math.max(share(lucid, need), share(day - 1, total)) };
}

export const moveOnRules: Record<CourseLesson, (d: CourseData) => MoveOn> = {
  recall: (d) => {
    const from = addDays(d.today, -6);
    const dreams = past(d).filter((n) => n.date >= from).reduce((s, n) => s + n.dreamCount, 0);
    return {
      ready: dreams >= 4, share: share(dreams, 4),
      progress: `${Math.min(dreams, 4)} of 4 dreams this week`,
      reason: "Recall predicts success with every later technique, so it comes first.",
    };
  },
  "journal-habits": (d) => {
    const streak = journalStreak(past(d), d.today);
    return {
      ready: streak >= 7, share: share(streak, 7),
      progress: `${Math.min(streak, 7)} of 7 mornings in a row`,
      reason: "A week of daily entries makes the journal a habit and gives the dream sign inventory enough dreams.",
    };
  },
  "reality-checks": (d) => {
    const from = d.since ?? d.today;
    const perDay = new Map<string, number>();
    for (const day of d.checkDays) if (day >= from && day <= d.today) perDay.set(day, (perDay.get(day) ?? 0) + 1);
    const good = [...perDay.values()].filter((n) => n >= 5).length;
    return {
      ready: good >= 7, share: share(good, 7),
      progress: `${Math.min(good, 7)} of 7 days with 5 or more checks`,
      reason: "A week of real checks every day builds the questioning habit that carries into dreams.",
    };
  },
  "mild-wbtb": (d) => lucidOrWeeks(d, 1, 4, "Your first lucid dream shows the protocol works for you; after 4 weeks without one, adjust it rather than keep pushing."),
  stabilise: (d) => lucidOrWeeks(d, 2, 4, "A couple of lucid dreams give the first-seconds routine a real try."),
  "ssild-wild": (d) => {
    const nights = sinceStart(d).filter((n) => [...(n.techniquesPlanned ?? []), ...(n.techniquesDone ?? [])].some((t) => t === "ssild" || t === "wild")).length;
    const day = daysBetween(d.since ?? d.today, d.today) + 1;
    return {
      ready: nights >= 4 || day > 28, share: Math.max(share(nights, 4), share(day - 1, 28)),
      progress: `${Math.min(nights, 4)} of 4 nights with SSILD or WILD`,
      reason: "A few nights are enough to know whether either method suits you; keep MILD on the others.",
    };
  },
  "dream-control": (d) => lucidOrWeeks(d, 2, 4, "Trying a planned task in a couple of lucid dreams is the point of this lesson."),
  troubleshooting: (d) => {
    const items = d.items ?? [];
    const ticked = new Set(d.practice.filter((p) => p.done).map((p) => p.item));
    const n = items.filter((i) => ticked.has(i)).length;
    return {
      ready: items.length > 0 && n >= items.length, share: share(n, items.length),
      progress: `${n} of ${plural(items.length, "item")} done once`,
      reason: "The last lesson is a checklist to come back to; finish it when each item has been tried.",
    };
  },
};

export function moveOn(lesson: string, d: CourseData): MoveOn | null {
  const rule = (moveOnRules as Record<string, ((d: CourseData) => MoveOn) | undefined>)[lesson];
  return rule ? rule(d) : null;
}

/**
 * The night "tonight" belongs to: a night is filed under the morning's date, so in the evening that is tomorrow.
 * In the small hours (before `cutoff`, 5:00 by default) the night is still going and its morning is today.
 */
export function tonightOf(today: string, hour: number, cutoff = 5): string {
  return hour < cutoff ? today : addDays(today, 1);
}

/** The course's current lesson: the active one, else the first not done. Null when every lesson is done. */
export function currentLesson(rows: { lessonId: string; state: string }[]): CourseLesson | null {
  const active = rows.find((r) => r.state === "active" && (COURSE_LESSONS as readonly string[]).includes(r.lessonId));
  if (active) return active.lessonId as CourseLesson;
  const done = new Set(rows.filter((r) => r.state === "done" || r.state === "skipped").map((r) => r.lessonId));
  return COURSE_LESSONS.find((l) => !done.has(l)) ?? null;
}

export function nextLesson(id: string): CourseLesson | null {
  const i = (COURSE_LESSONS as readonly string[]).indexOf(id);
  return i >= 0 ? COURSE_LESSONS[i + 1] ?? null : null;
}
