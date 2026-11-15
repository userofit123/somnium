// "Today's step" at the top of Home (LDJ-107): the one thing to do now, from the course lesson you are on, the time of
// day and what is already logged. The study protocols that worked gave people a concrete daily schedule rather than a
// menu (RESEARCH.md Part D §6.8 [D11][D12][D5]), so Home leads with one step and the other cards follow, quieter.
// Pure: the caller passes the hour and the counts; the lesson texts and the move-on rule (course.ts) stay where they are.
// The Today checklist already lists the practice items one by one, so a step only names how many are left.
import { COURSE_LESSONS } from "./course";
import { NIGHT_CUTOFF } from "./home";

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
  /** Today's evening review is ticked. */
  reviewed: boolean;
  /** Tonight's plan: the techniques' titles (WBTB left out) and the WBTB alarm as a formatted time, or null. */
  tonight: { titles: string[]; wbtbAt: string | null };
}

export type StepKind = "write" | "moveOn" | "finish" | "checks" | "practice" | "plan" | "tonight" | "review" | "done";

export interface Step {
  kind: StepKind;
  title: string;
  /** Where you are or what to do, in a few words; "" when the title says it all. */
  line: string;
  /** Why this step, one plain sentence; its sources are `sources` (RESEARCH.md reference ids). */
  why: string;
  sources: string[];
  /** The step's one button: a route, or an action the card runs ("write" a new dream, "moveOn" to the next lesson). */
  action: { label: string; to?: string; run?: "write" | "moveOn" } | null;
}

/** The lesson from which tonight's step is a technique plan rather than an intention (lesson 4, MILD + WBTB). */
const PLAN_FROM = COURSE_LESSONS.indexOf("mild-wbtb");
/** The lesson from which the day's step is the reality checks (lesson 3). */
const CHECKS_FROM = COURSE_LESSONS.indexOf("reality-checks");
/** The reality checks lesson's rule counts days with 5 or more checks (course.ts). */
const RC_LESSON_MIN = 5;

/** What tonight's plan holds for each lesson from MILD on, when nothing is planned yet. */
const PLAN_LINE: Record<string, string> = {
  "mild-wbtb": "MILD, with WBTB on a night you can sleep in after",
  stabilise: "MILD, and the first-seconds routine ready for when you become lucid",
  "ssild-wild": "SSILD or WILD after WBTB on a free night, MILD on the others",
  "dream-control": "MILD, and the task you want to try in a lucid dream",
  troubleshooting: "The technique that has worked best for you",
};

const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const lessonAt = (l: StepLesson | null) => (l ? COURSE_LESSONS.indexOf(l.id as (typeof COURSE_LESSONS)[number]) : COURSE_LESSONS.length);

/** Tonight's plan in a few words: "WBTB at 03:30 and MILD". Empty when nothing is planned. */
export function tonightLine(t: StepInput["tonight"]): string {
  const parts = [...(t.wbtbAt ? [`WBTB at ${t.wbtbAt}`] : []), ...t.titles];
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0] ?? "";
}

/**
 * Today's step. In order: write last night's dream (daytime, until it is written); move on once the lesson's rule is
 * met; in the evening (from 18:00 until the night turns at 05:00) tonight's plan or, before MILD, the evening review
 * and the intention to remember; in the day the reality checks (from lesson 3), then the lesson's practice; else done.
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
    why: "The courses that worked moved on one step at a time once each step held; a fresh step also keeps motivation up, which raised LaBerge's own rate.",
    sources: ["D5", "D1"], action: { label: "Move on", run: "moveOn" },
  } : {
    kind: "finish", title: "You have tried every item: finish the course", line: "The lessons stay in Train to come back to.",
    why: "The last lesson is a checklist to come back to when progress stalls.",
    sources: ["D1", "D5"], action: { label: "Finish the course", run: "moveOn" },
  };

  if (evening) {
    if (at >= PLAN_FROM) {
      const planned = tonightLine(i.tonight);
      const why = "MILD after a short wake late in the night was the best-supported combination in the studies.";
      return planned
        ? { kind: "tonight", title: `Tonight: ${planned}`, line: "Planned. Keep the journal by the bed.", why, sources: ["D11", "D12"], action: { label: "Open tonight", to: "/train/tonight" } }
        : { kind: "plan", title: "Plan tonight", line: PLAN_LINE[i.lesson?.id ?? ""] ?? PLAN_LINE.troubleshooting!, why, sources: ["D11", "D12"], action: { label: "Set it up", to: "/train/tonight" } };
    }
    if (!i.reviewed) return {
      kind: "review", title: "Do the evening review", line: "Tomorrow's intention and your top dream sign, in a minute or two.",
      why: "Going over what you mean to notice just before sleep is how the programmes set up the night's intention.",
      sources: ["D1", "D5"], action: { label: "Start the review", to: "/train/review" },
    };
    return {
      kind: "tonight", title: "Tonight: tell yourself you will remember your dreams", line: "Keep the journal by the bed and lie still when you wake.",
      why: "An intention to remember, and a still moment on waking, are the first step of the recall programmes.",
      sources: ["D1", "D5"], action: null,
    };
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
    kind: "done", title: "Today's step is done", line: "Tonight's step shows here from 6 pm.",
    why: "Steady daily practice is what the study schedules asked for, not more of it; rest is part of it.",
    sources: ["D11", "D1"], action: null,
  };
}
