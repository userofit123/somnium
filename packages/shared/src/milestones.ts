// Milestones (LDJ-117): the first lucid dream, the first one from a technique, the first clear one (level 3+). Each gets
// one calm moment when the dream is saved, then never again: what was seen is a plain id, a day and a dream id in the
// synced settings (settings.milestones, nothing personal), like the recommendations' dismissals. Pure: the editor
// passes the dream as it is now and the rest of the journal's plain facts.
import { TECHNIQUES } from "./journal";
import type { SetupExperience } from "./settings";
import { addDays, loggedNights, type NightLog } from "./rates";

export const MILESTONE_IDS = ["first-lucid", "first-technique", "first-clear"] as const;
export type MilestoneId = (typeof MILESTONE_IDS)[number];
export interface MilestoneSeen { on: string; dreamId: string }
export type Milestones = Partial<Record<MilestoneId, MilestoneSeen>>;

export interface MilestoneDream { id: string; nightId: string; lucid: boolean; lucidityLevel?: number | null; becameLucidHow?: string | null }
export interface MilestoneNight { id: string; techniquesDone?: string[] | null; wbtbUsed?: boolean | null }

/** How they became lucid, as a sentence for the moment (BECAME_LUCID_LABEL's answers); "other" says nothing. */
export const MILESTONE_HOW: Readonly<Record<string, string>> = {
  dream_sign: "You noticed a dream sign", reality_check: "A reality check showed you", wild: "You went in from waking (WILD)",
  nightmare: "A nightmare tipped you off", spontaneous: "It just happened this time",
};
/** "Lucid, some control" and up (LUCIDITY_ANCHORS): clear enough to act in the dream. */
export const CLEAR_LEVEL = 3;
/** Ways of becoming lucid that are a trained skill, not chance (BECAME_LUCID_LABEL). */
const TRAINED_HOW = new Set(["reality_check", "wild", "dream_sign"]);

/** The techniques the night's plan logged as done, as labels; WBTB counts too. Empty when there was no recipe. */
export function nightRecipe(n: MilestoneNight | undefined): string[] {
  if (!n) return [];
  const label = (id: string) => TECHNIQUES.find((t) => t.id === id)?.label ?? id;
  const out = (n.techniquesDone ?? []).map(label);
  if (n.wbtbUsed && !out.some((x) => /wbtb/i.test(x))) out.push("WBTB");
  return out;
}

const fromTechnique = (d: MilestoneDream, nights: ReadonlyMap<string, MilestoneNight>) =>
  d.lucid && (nightRecipe(nights.get(d.nightId)).length > 0 || TRAINED_HOW.has(d.becameLucidHow ?? ""));
const MET: Record<MilestoneId, (d: MilestoneDream, nights: ReadonlyMap<string, MilestoneNight>) => boolean> = {
  "first-lucid": (d) => d.lucid,
  "first-technique": fromTechnique,
  "first-clear": (d) => d.lucid && (d.lucidityLevel ?? 0) >= CLEAR_LEVEL,
};

/**
 * The milestones this dream reaches for the first time, the biggest first: met by this dream, by no other dream in the
 * journal, and not seen before. The first entry is the one to show; all of them are recorded, so a first lucid dream
 * that was also clear and from a technique is one moment, not three. Someone who told the setup they have had lucid
 * dreams before (experience "some" or "regular") gets no "first lucid dream": the first one logged here isn't theirs.
 */
export function dueMilestones(dream: MilestoneDream, others: readonly MilestoneDream[], nights: readonly MilestoneNight[], seen: Milestones | undefined, experience?: SetupExperience): MilestoneId[] {
  const byId = new Map(nights.map((n) => [n.id, n]));
  const rest = others.filter((d) => d.id !== dream.id);
  return MILESTONE_IDS.filter((id) => {
    if (seen?.[id]) return false;
    if (id === "first-lucid" && (experience === "some" || experience === "regular")) return false;
    return MET[id](dream, byId) && !rest.some((d) => MET[id](d, byId));
  });
}

/** The record to save for what was shown: every id due, the same day and dream. */
export const milestonesSeen = (ids: readonly MilestoneId[], dreamId: string, on: string): Milestones =>
  Object.fromEntries(ids.map((id) => [id, { on, dreamId }]));

/** What each moment says. Stabilising: excitement wakes new lucid dreamers (RESEARCH.md D1 ch. 6, D5 Unit 5). */
export const MILESTONE_TEXT: Record<MilestoneId, { title: string; line: string; sources: string[] }> = {
  "first-lucid": { title: "Your first lucid dream", line: "Most people need weeks of practice to get here.", sources: ["B36", "B76"] },
  "first-technique": { title: "A lucid dream from your practice", line: "This one came from something you did on purpose, so it can happen again.", sources: ["B76"] },
  "first-clear": { title: "Your clearest lucid dream yet", line: "You knew you were dreaming and had some say in it.", sources: ["B76"] },
};
export const NEXT_TIME = "Next time: stay calm, rub your hands together and feel it, then look around at the details, keeping your eyes moving. It keeps the dream from fading.";
export const NEXT_TIME_SOURCES = ["D1", "D5", "D11", "D7"] as const;
export const STABILISE_LESSON = "/train/lesson/stabilise";

// ---------- Your path (LDJ-154) ----------
// The quiet list on Progress (and an optional Home card): the steps reached so far, each with its date, and the next
// one with what it takes. Worked out from the journal each time, so nothing new is stored; the moments above stay the
// one-time cards. No points or badges: plain text and a date. The recall steps are the Course's first targets
// (RESEARCH.md C2, D5, Part D §6.9); seeing progress keeps people going (D1 ch. 3).

export const PATH_IDS = [
  "logged-week", "first-lesson", "recall-week", "two-dreams", "first-lucid", "first-technique", "first-clear", "first-sign",
  "lucid-5", "lucid-10", "lucid-25", "nightmare-lucid", "course-done",
] as const;
export type PathId = (typeof PATH_IDS)[number];
/** Never offered as the next step: nobody should aim for a nightmare. Shown once it has happened. */
const NOT_AIMED = new Set<PathId>(["nightmare-lucid"]);

export interface PathNight extends NightLog { id: string; date: string; nap?: boolean }
export interface PathDream extends MilestoneDream { date: string; nap?: boolean; nightmare?: boolean }
/** A course lesson's row with the local day it was finished (YYYY-MM-DD), null while not done. */
export interface PathLesson { lessonId: string; doneOn: string | null }
export interface PathStep { id: PathId; title: string; on?: string; have?: number; need?: number; takes?: string }

export const PATH_TITLE: Record<PathId, string> = {
  "logged-week": "A week of mornings in your journal",
  "first-lesson": "Your first course lesson finished",
  "recall-week": "A dream remembered 7 nights in a row",
  "two-dreams": "Two dreams from one night",
  "first-lucid": "Your first lucid dream",
  "first-technique": "A lucid dream from your practice",
  "first-clear": "A clear lucid dream (level 3 or more)",
  "first-sign": "Lucid by noticing a dream sign",
  "lucid-5": "5 lucid dreams",
  "lucid-10": "10 lucid dreams",
  "lucid-25": "25 lucid dreams",
  "nightmare-lucid": "A nightmare turned lucid",
  "course-done": "The whole course finished",
};
/** Where the steps come from: recall targets and the course's order (C2, D5, §6.9), motivation (D1 ch. 3). */
export const PATH_SOURCES = ["C2", "D5", "D1"] as const;
const PATH_DAYS = 7, LUCID_COUNTS = { "lucid-5": 5, "lucid-10": 10, "lucid-25": 25 } as const;

const plural = (n: number, w: string) => `${n} ${n === 1 ? w : w + "s"}`;

/**
 * The path: steps reached (oldest first, each with the day it happened) and the next one in the path's order with how
 * far there is to go. Naps are left out (a nap is not a night of recall). Someone who told the setup they have had
 * lucid dreams before reads "first lucid dream logged here", since their real first one came before the journal.
 */
export function yourPath(nights: readonly PathNight[], dreams: readonly PathDream[], lessons: readonly PathLesson[], courseSize: number, experience?: SetupExperience): { reached: PathStep[]; next: PathStep | null } {
  const real = nights.filter((n) => !n.nap);
  const ids = new Set(real.map((n) => n.id));
  const count = new Map<string, number>();
  for (const d of dreams) if (!d.nap && ids.has(d.nightId)) count.set(d.nightId, (count.get(d.nightId) ?? 0) + 1);
  const logged = loggedNights(real.map((n) => ({ ...n, dreamCount: count.get(n.id) ?? n.dreamCount ?? 0 }))).sort((a, b) => a.date.localeCompare(b.date));
  const recalled = [...new Set(logged.filter((n) => n.dreamCount > 0).map((n) => n.date))].sort();
  const byId = new Map(nights.map((n) => [n.id, n]));
  const lucid = dreams.filter((d) => d.lucid && !d.nap).sort((a, b) => a.date.localeCompare(b.date));
  const done = lessons.flatMap((l) => (l.doneOn ? [l.doneOn] : [])).sort();
  const first = (pred: (d: PathDream) => boolean) => lucid.find(pred)?.date;

  // the longest run of mornings with a dream so far, and the day a run first reached 7
  let run = 0, best = 0, recallWeek: string | undefined;
  recalled.forEach((day, i) => {
    run = i > 0 && addDays(recalled[i - 1]!, 1) === day ? run + 1 : 1;
    best = Math.max(best, run);
    if (run === PATH_DAYS && !recallWeek) recallWeek = day;
  });
  const days = [...new Set(logged.map((n) => n.date))];

  const on: Record<PathId, string | undefined> = {
    "logged-week": days[PATH_DAYS - 1],
    "first-lesson": done[0],
    "recall-week": recallWeek,
    "two-dreams": logged.find((n) => n.dreamCount >= 2)?.date,
    "first-lucid": lucid[0]?.date,
    "first-technique": first((d) => fromTechnique(d, byId)),
    "first-clear": first((d) => (d.lucidityLevel ?? 0) >= CLEAR_LEVEL),
    "first-sign": first((d) => d.becameLucidHow === "dream_sign"),
    "lucid-5": lucid[4]?.date, "lucid-10": lucid[9]?.date, "lucid-25": lucid[24]?.date,
    "nightmare-lucid": first((d) => !!d.nightmare || d.becameLucidHow === "nightmare"),
    "course-done": courseSize > 0 && done.length >= courseSize ? done[courseSize - 1] : undefined,
  };
  const experienced = experience === "some" || experience === "regular";
  const title = (id: PathId) => (id === "first-lucid" && experienced ? "Your first lucid dream logged here" : PATH_TITLE[id]);

  // what the next step takes, in plain words, with the count so far where there is one
  const takes = (id: PathId): Omit<PathStep, "id" | "title"> => {
    switch (id) {
      case "logged-week": return { have: days.length, need: PATH_DAYS, takes: `${plural(PATH_DAYS - days.length, "more morning")} written down, dreams or not.` };
      case "first-lesson": return { takes: "Work through the first lesson in Train." };
      case "recall-week": return { have: best, need: PATH_DAYS, takes: `At least one dream a night, 7 nights running. Your longest run so far: ${plural(best, "night")}.` };
      case "two-dreams": return { takes: "Before you move in the morning, ask what you were dreaming, then what came before that." };
      case "first-lucid": case "first-technique": return { takes: "Keep up the practice in tonight's plan." };
      case "first-clear": return { takes: "Once lucid, stay calm and look at the details to keep it going." };
      case "first-sign": return { takes: "Check your target dream sign whenever it turns up during the day." };
      case "lucid-5": case "lucid-10": case "lucid-25": return { have: lucid.length, need: LUCID_COUNTS[id], takes: `${plural(LUCID_COUNTS[id] - lucid.length, "more lucid dream")} to go.` };
      case "course-done": return { have: done.length, need: courseSize, takes: `${plural(courseSize - done.length, "lesson")} left.` };
      default: return {};
    }
  };
  const reached = PATH_IDS.filter((id) => on[id]).map((id): PathStep => ({ id, title: title(id), on: on[id] }))
    .sort((a, b) => a.on!.localeCompare(b.on!) || PATH_IDS.indexOf(a.id) - PATH_IDS.indexOf(b.id));
  const nextId = PATH_IDS.find((id) => !on[id] && !NOT_AIMED.has(id) && !(id === "course-done" && courseSize <= 0));
  return { reached, next: nextId ? { id: nextId, title: title(nextId), ...takes(nextId) } : null };
}
