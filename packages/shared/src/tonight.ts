// Tonight's suggested plan (LDJ-108): what to do tonight from the course lesson you are on and whether tonight is a
// night you can sleep in after. Lessons 1-2 build recall (an intention to remember dreams), lesson 3 adds dream sign
// rehearsal, lesson 4 on is MILD, with WBTB before it on free nights: MILD + WBTB is the best-supported combination
// [B37][B38][B39][D11]. WBTB costs sleep, so it is suggested only on a night you can sleep in, never two nights in a
// row and at most 3 in 7 nights, and never with "sleep first" on or before the safety check [B69][D1]. From the SSILD
// lesson on, SSILD is offered as the alternative: it matched MILD in the largest field study [B38].
import { COURSE_LESSONS } from "./course";
import { addDays } from "./rates";

export interface TonightIdea {
  /** techniques_planned for the night ("wbtb" included when it is a WBTB night) */
  techniques: string[];
  /** a WBTB alarm goes with it */
  wbtb: boolean;
  /** short name, e.g. "WBTB + MILD" */
  title: string;
  /** why, Markdown inline with its sources */
  reason: string;
}

export interface TonightSuggestion extends TonightIdea {
  /** the intention it fills in when none is set */
  intention: string;
  /** why WBTB is left out tonight, with its sources; empty when it is in or not part of this lesson */
  noWbtb: string;
  /** from the SSILD lesson on: SSILD instead of MILD */
  alt: TonightIdea | null;
}

export interface TonightInput {
  /** the current course lesson (course.ts currentLesson); null once every lesson is done */
  lesson: string | null;
  /** the morning date tonight is filed under (course.ts tonightOf) */
  date: string;
  /** weekdays of the evenings you can sleep in after (0 Sunday ... 6 Saturday): settings.sleep.freeNights */
  freeNights: readonly number[];
  /** settings.safety */
  sleepFirst: boolean;
  safetyChecked: boolean;
  /** morning dates of the nights with WBTB used or planned, tonight's own left out */
  wbtbNights: readonly string[];
}

/** At most this many WBTB nights in any 7 [B69]. */
export const WBTB_WEEK_MAX = 3;

/** settings.sleep.freeNights made safe (it syncs from any device): whole weekdays 0-6, once each, in order. */
export const freeNightsOf = (v: unknown): number[] =>
  Array.isArray(v) ? [...new Set(v.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b) : [];

/** The weekday (0 Sunday) of the evening a night begins: the day before its morning date. */
export const eveningWeekday = (morning: string) => new Date(`${addDays(morning, -1)}T12:00:00Z`).getUTCDay();

const RECALL_INTENTION = "Tonight I will remember my dreams";
const SIGN_INTENTION = "Next time I see one of my dream signs, I will notice I am dreaming";
const MILD_INTENTION = "Next time I'm dreaming, I will remember I'm dreaming";
const SAFE = "WBTB costs sleep, so it is only suggested on nights you can sleep in, never two in a row and at most 3 a week [B69][D1].";

/** Why WBTB is left out tonight, or "" when it can go in. */
export function wbtbBlock(i: Pick<TonightInput, "date" | "freeNights" | "sleepFirst" | "safetyChecked" | "wbtbNights">): string {
  if (i.sleepFirst) return "Sleep first is on, so WBTB isn't suggested [B69][D1].";
  if (!i.safetyChecked) return "WBTB is suggested once you have done the safety check (Settings, Sleep schedule) [B69].";
  if (!i.freeNights.length) return "Choose the nights you can sleep in (Settings, Sleep schedule) to have WBTB suggested on them [B69][D1].";
  if (!i.freeNights.includes(eveningWeekday(i.date))) return "Tonight isn't one of the nights you can sleep in, so no WBTB [B69][D1].";
  const done = new Set(i.wbtbNights);
  if (done.has(addDays(i.date, -1))) return "Last night was a WBTB night; not two in a row [B69][D1].";
  const from = addDays(i.date, -6);
  const week = [...done].filter((d) => d >= from && d < i.date).length;
  if (week >= WBTB_WEEK_MAX) return `Already ${week} WBTB nights this week; ${WBTB_WEEK_MAX} at most [B69][D1].`;
  return "";
}

/** Tonight's suggested plan. */
export function suggestTonight(i: TonightInput): TonightSuggestion {
  const at = i.lesson === null ? COURSE_LESSONS.length : Math.max(0, (COURSE_LESSONS as readonly string[]).indexOf(i.lesson));
  if (at <= 1) return {
    techniques: ["journaling"], wbtb: false, title: "Recall intention", intention: RECALL_INTENTION, noWbtb: "", alt: null,
    reason: "Your lesson builds dream recall first: as you fall asleep, tell yourself you will remember your dreams, and write them down when you wake. Keeping a dream log raises recall [B48].",
  };
  if (at === 2) return {
    techniques: ["dream-signs"], wbtb: false, title: "Intention + dream sign rehearsal", intention: SIGN_INTENTION, noWbtb: "", alt: null,
    reason: "Your lesson adds dream signs: in bed, picture your most common dream sign and see yourself noticing it and realising you are dreaming. It is the core of MILD [D1][D3].",
  };
  const noWbtb = wbtbBlock(i);
  const wbtb = !noWbtb;
  const mild: TonightIdea = wbtb
    ? { techniques: ["mild", "wbtb"], wbtb: true, title: "WBTB + MILD", reason: `Tonight you can sleep in: an alarm a few hours before your usual wake time, a short time up, then MILD as you fall back asleep. It is the best-supported combination [B37][B38][B39][D11]. ${SAFE}` }
    : { techniques: ["mild"], wbtb: false, title: "MILD at bedtime", reason: "MILD as you fall asleep: the best-supported technique in the studies [B37][B38][D11]." };
  const alt: TonightIdea | null = at >= (COURSE_LESSONS as readonly string[]).indexOf("ssild-wild")
    ? { techniques: wbtb ? ["ssild", "wbtb"] : ["ssild"], wbtb, title: wbtb ? "WBTB + SSILD" : "SSILD at bedtime", reason: "SSILD instead of MILD: in the largest field study it did as well as MILD [B38]." }
    : null;
  return { ...mild, intention: MILD_INTENTION, noWbtb, alt };
}
