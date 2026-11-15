// Milestones (LDJ-117): the first lucid dream, the first one from a technique, the first clear one (level 3+). Each gets
// one calm moment when the dream is saved, then never again: what was seen is a plain id, a day and a dream id in the
// synced settings (settings.milestones, nothing personal), like the recommendations' dismissals. Pure: the editor
// passes the dream as it is now and the rest of the journal's plain facts.
import { TECHNIQUES } from "./journal";
import type { SetupExperience } from "./settings";

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
