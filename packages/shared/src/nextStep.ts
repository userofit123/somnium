// "Today's step" at the top of Home (LDJ-107): the one thing to do now, from the course lesson you are on, the time of
// day and what is already logged. The study protocols that worked gave people a concrete daily schedule rather than a
// menu (RESEARCH.md Part D §6.8 [D11][D12][D5]), so Home leads with one step and the other cards follow, quieter.
// Pure: the caller passes the hour and the counts; the lesson texts and the move-on rule (course.ts) stay where they are.
// The Today checklist already lists the practice items one by one, so a step only names how many are left. The evening
// step names tonight's suggested plan as Train · Tonight has it (tonight.ts suggestTonight), so the two never differ.
import { COURSE_LESSONS } from "./course";
import { NIGHT_CUTOFF } from "./home";
import { reasonParts } from "./tonight";

export interface StepLesson { id: string; number: number; title: string }

export interface StepInput {
  /** The local hour, 0-23. */
  hour: number;
  /** The current lesson, or null once every lesson is done. */
  lesson: StepLesson | null;
  /** The lesson after it, or null on the last one. */
  next: StepLesson | null;
  /** Last night has a dream or a "No recall" mark. */
  wrote: boolean;
  /** The lesson's move-on rule is met (course.ts moveOn). */
  ready: boolean;
  /** Reality checks today against today's target. */
  checks: { done: number; target: number };
  /** The lesson's practice items ticked today. */
  practice: { done: number; total: number };
  /** This evening's review is ticked (before 05:00, last evening's: home.ts eveningOf). */
  reviewed: boolean;
  /** Tonight: the suggested plan's title and reason (suggestTonight), whether a plan is set, its WBTB alarm formatted. */
  tonight: { title: string; reason: string; planned: boolean; wbtbAt: string | null };
}

export type StepKind = "write" | "moveOn" | "finish" | "checks" | "practice" | "plan" | "tonight" | "review" | "done";

export interface Step {
  kind: StepKind;
  title: string;
  /** Where you are or what to do, in a few words; "" when the title says it all. */
  line: string;
  /** Why this step, in plain words; its sources are `sources` (RESEARCH.md reference ids). */
  why: string;
  sources: string[];
  /** The step's one button: a route, or an action the card runs ("write" a new dream, "moveOn" to the next lesson). */
  action: { label: string; to?: string; run?: "write" | "moveOn" } | null;
}

/** The lesson from which the evening review is no longer a step of its own (lesson 4, MILD + WBTB: the plan is). */
const PLAN_FROM = COURSE_LESSONS.indexOf("mild-wbtb");
/** The lesson from which the day's step is the reality checks (lesson 3). */
const CHECKS_FROM = COURSE_LESSONS.indexOf("reality-checks");
/** The reality checks lesson's rule counts days with 5 or more checks (course.ts). */
const RC_LESSON_MIN = 5;

const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const lessonAt = (l: StepLesson | null) => (l ? COURSE_LESSONS.indexOf(l.id as (typeof COURSE_LESSONS)[number]) : COURSE_LESSONS.length);

/**
 * Today's step. In order: write last night's dream (daytime, until it is written); move on once the lesson's rule is
 * met; in the evening (from 18:00 until the night turns at 05:00) tonight's suggested plan, after the evening review
 * before MILD; in the day the reality checks (from lesson 3), then the lesson's practice; else done.
 */
export function stepFor(i: StepInput): Step {
  const at = lessonAt(i.lesson);
  const evening = i.hour >= 18 || i.hour < NIGHT_CUTOFF;

  if (!i.wrote && !evening) return {
    kind: "write", title: "Write down last night's dream", line: "Even a fragment counts, or mark No recall.",
    why: "Recall predicts success with every later technique, so every programme starts with the journal.",
    sources: ["D12", "D5"], action: { label: "Write last night's dream", run: "write" },
  };

  if (i.ready && i.lesson) return i.next ? {
    kind: "moveOn", title: `You are ready for lesson ${i.next.number}: ${i.next.title}`, line: `Lesson ${i.lesson.number} has done its job.`,
    why: "The courses that worked moved on one step at a time once each step held.",
    sources: ["D5"], action: { label: "Move on", run: "moveOn" },
  } : {
    kind: "finish", title: "You have tried every item: finish the course", line: "The lessons stay in Train to come back to.",
    why: "The last lesson is a checklist to come back to when progress stalls.",
    sources: ["D1", "D5"], action: { label: "Finish the course", run: "moveOn" },
  };

  if (evening) {
    if (at < PLAN_FROM && !i.reviewed) return {
      kind: "review", title: "Do the evening review", line: "Tomorrow's intention and your top dream sign, in a minute or two.",
      why: "Going over what you mean to notice just before sleep is how the programmes set up the night's intention.",
      sources: ["D1", "D5"], action: { label: "Start the review", to: "/train/review" },
    };
    const { text, sources } = reasonParts(i.tonight.reason);
    return i.tonight.planned
      ? { kind: "tonight", title: "Tonight's plan is set", line: [i.tonight.wbtbAt ? `WBTB alarm at ${i.tonight.wbtbAt}` : "", "Keep the journal by the bed."].filter(Boolean).join(" · "), why: text, sources, action: { label: "Open tonight", to: "/train/tonight" } }
      : { kind: "plan", title: `Tonight: ${i.tonight.title}`, line: "Not set up yet.", why: text, sources, action: { label: "Set it up", to: "/train/tonight" } };
  }

  if (at >= CHECKS_FROM) {
    const target = i.lesson?.id === "reality-checks" ? Math.max(RC_LESSON_MIN, i.checks.target) : i.checks.target;
    if (i.checks.done < target) return {
      kind: "checks", title: `Do ${plural(target, "reality check")} today`, line: `${i.checks.done} done`,
      why: "The study schedules had people test whether they were dreaming several times a day, each time as a real question.",
      sources: ["D11", "D1"], action: { label: "Log a check", to: "/check" },
    };
  }

  if (i.lesson && i.practice.done < i.practice.total) {
    const left = i.practice.total - i.practice.done;
    return {
      kind: "practice", title: `${plural(left, "practice item")} left in ${i.lesson.title}`, line: `${i.practice.done} of ${i.practice.total} done · ticked in Today below`,
      why: "The protocols that worked gave people a short, concrete practice for each day.",
      sources: ["D11", "D5"], action: { label: "Read the lesson", to: `/train/lesson/${i.lesson.id}` },
    };
  }

  return {
    kind: "done", title: "Today's step is done", line: "Tonight's step shows here this evening.",
    why: "Steady daily practice is what the study schedules asked for.",
    sources: ["D11", "D1"], action: null,
  };
}
