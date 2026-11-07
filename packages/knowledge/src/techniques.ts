// The techniques library in Train (PLAN.md §6.4, LDJ-23): which article each technique is, its family, and its
// evidence badge. The badge is never a judgement made here: it restates RESEARCH.md Part B §3.12 (the summary
// table) where the technique has a row there, and otherwise the article's own "Evidence level" paragraph. `basis`
// says which, in a sentence that cites its source, and the test checks that every cited id exists.
import type { TechniqueId } from "./content";

export type Evidence = "strong" | "some" | "weak" | "anecdotal";
export const evidenceLabel: Record<Evidence, string> = {
  strong: "Strong evidence", some: "Some evidence", weak: "Weak or negative", anecdotal: "Anecdotal",
};

export const families = [
  { id: "daytime", title: "Day-time and recall" },
  { id: "dream", title: "Dream-initiated" },
  { id: "wake", title: "Wake-initiated" },
  { id: "support", title: "Supporting" },
  { id: "in-dream", title: "In the dream" },
] as const;
export type Family = (typeof families)[number]["id"];

export interface Technique {
  id: TechniqueId;
  /** The Learn article, `techniques/<slug>`. */
  slug: string;
  family: Family;
  evidence: Evidence;
  /** Where the grade comes from, with citations (Markdown inline). */
  basis: string;
  /** Sleep-interrupting or sleep-onset practice: its page shows the safety note. */
  safety?: boolean;
}

const t = (id: TechniqueId, slug: string, family: Family, evidence: Evidence, basis: string, safety = false): Technique =>
  ({ id, slug, family, evidence, basis, ...(safety ? { safety } : {}) });

export const techniques: readonly Technique[] = [
  t("journaling", "journaling", "daytime", "some", "A prerequisite that raises recall; no trial shows journaling alone induces lucidity [B48][B33]."),

  t("mild", "mild", "dream", "strong", "The best-supported technique, replicated across labs and large field studies [B37][B38][B39]."),
  t("reality-testing", "reality-testing", "dream", "weak", "Weak as a standalone and the least effective arm in field studies; it helps as part of MILD, not alone [B37][B38][B35]."),
  t("tholey-combined", "tholey-combined", "dream", "some", "Older, small studies; promising but not replicated recently [B36]."),
  t("dream-signs", "dream-signs", "dream", "anecdotal", "Part of MILD and the DreamLight studies, never tested on its own [D1][D3]."),
  t("ada", "ada", "dream", "anecdotal", "Community reports only; the success rates are the author's own [D20]."),
  t("prospective-memory", "prospective-memory", "dream", "anecdotal", "The reasoning comes from memory research; the exercise has no test of its own [D1]."),
  t("autosuggestion", "autosuggestion", "dream", "anecdotal", "Case reports and self-experiment; effortful intention (MILD) worked far better in the lab [D1]."),
  t("cat", "cat", "dream", "anecdotal", "The originator's reports; no study [D24]."),

  t("wild", "wild", "wake", "anecdotal", "Lab-documented, but no controlled trial has tested it as a technique [B15].", true),
  t("ssild", "ssild", "wake", "some", "One large field study, where it matched MILD [B38].", true),
  t("fild", "fild", "wake", "anecdotal", "Community reports; no study [D21].", true),
  t("deild", "deild", "wake", "anecdotal", "Lab-documented re-entry, no controlled training trial [B15].", true),
  t("vild", "vild", "wake", "anecdotal", "Community reports; no study [D23]."),
  t("re-entry", "re-entry", "wake", "anecdotal", "Case reports; no controlled training trial [D1][B15].", true),

  t("wbtb", "wbtb", "support", "some", "An amplifier, not separable from what you do while awake: it works together with MILD or SSILD, and alone (reading, gaming) it did little [B39][B40][B38].", true),
  t("nap", "nap", "support", "some", "Controlled field studies by one group, not independently replicated [D4]."),
  t("incubation", "incubation", "support", "some", "One controlled study of ordinary incubation; lucid incubation rests on case reports [D27][D1]."),
  t("meditation", "meditation", "support", "weak", "Negative trial: meditators have more lucid dreams, but an 8-week course changed nothing [B46]."),
  t("sound-cue", "sound-cue", "support", "strong", "Replicated in two labs, with one app study [B42][B43][B44]."),

  t("stabilisation", "stabilisation", "in-dream", "anecdotal", "The originators' own records; no trial compares stabilisers [D1][D11]."),
  t("control", "dream-control", "in-dream", "anecdotal", "Self-report and phenomenological studies; control is rarer than lucidity itself [B31][D1]."),
  t("nightmares", "nightmares-and-lucidity", "in-dream", "some", "Most small studies report fewer nightmares, but samples are tiny [B62][B63]."),
];

export const findTechnique = (id: string) => techniques.find((x) => x.id === id);
// Strongest first within a family (LDJ-68), so a well-supported technique such as sound cues isn't listed last;
// ties keep the order above.
const evidenceRank: Record<Evidence, number> = { strong: 0, some: 1, weak: 2, anecdotal: 3 };
export const inFamily = (family: Family) =>
  techniques.filter((x) => x.family === family).sort((a, b) => evidenceRank[a.evidence] - evidenceRank[b.evidence]);

/**
 * The quiet note on the sleep-interrupting and sleep-onset pages (WBTB, WILD, SSILD, FILD, DEILD, re-entry) and
 * on the lessons that teach them or nightmare work: RESEARCH.md Part B §6.2 and §6.3, in short.
 * Markdown inline, so the citations open the source sheet like everywhere else in Learn.
 */
export const safetyLines: readonly string[] = [
  "Sleep comes first. Never shorten your total sleep to make room for this; keep it for nights when you can sleep in afterwards [B69].",
  "Ease off if sleep suffers: two or three nights a week at most, and stop for a while if daytime sleepiness, mood or concentration suffer for more than a few days [B69][D1].",
  "Be careful, and talk to a clinician first, if you have a psychotic, bipolar or dissociative disorder, an active sleep disorder, or are in acute depression, grief or PTSD without clinical support (nightmare work is best done with a therapist) [B72][B71][B69][B60][B73].",
];
