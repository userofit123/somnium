// Self-assessment scales for Learn -> "Where am I". The wording is exactly what RESEARCH.md Part B section 7
// gives (the scales' anchors and the standard definition); no question text has been added to it.
// The Dream Lucidity Questionnaire (DLQ) is left out: RESEARCH.md names it but does not list its items.

export type AssessmentId = "ldfs" | "madre";

export interface Assessment {
  id: AssessmentId;
  title: string;
  /** Where the wording comes from. */
  source: string;
  /** Shown above the choices when the scale has a standard definition (RESEARCH.md 7.1). */
  definition?: string;
  options: { value: number; label: string; /** Converted rate used for analysis. */ rate: number }[];
  /** What `rate` counts. */
  unit: string;
}

export const assessments: Record<AssessmentId, Assessment> = {
  ldfs: {
    id: "ldfs",
    title: "Lucid dream frequency",
    source: "Lucid Dream Frequency Scale (Stumbrys, Erlacher & Schredl 2013)",
    definition: "In a lucid dream, one is aware that one is dreaming during the dream. Thus it is possible to wake up deliberately, or to influence the action of the dream actively, or to observe the course of the dream passively.",
    unit: "a month",
    options: [
      { value: 0, label: "Never", rate: 0 },
      { value: 1, label: "Less than once a year", rate: 0.042 },
      { value: 2, label: "About once a year", rate: 0.083 },
      { value: 3, label: "About 2 to 4 times a year", rate: 0.25 },
      { value: 4, label: "About once a month", rate: 1 },
      { value: 5, label: "About 2 to 3 times a month", rate: 2.5 },
      { value: 6, label: "About once a week", rate: 4 },
      { value: 7, label: "Several times a week", rate: 8 },
    ],
  },
  madre: {
    id: "madre",
    title: "Dream recall frequency",
    source: "Mannheim Dream Questionnaire, MADRE (Schredl et al. 2014)",
    unit: "mornings a week",
    options: [
      { value: 0, label: "Never", rate: 0 },
      { value: 1, label: "Less than once a month", rate: 0.125 },
      { value: 2, label: "About once a month", rate: 0.25 },
      { value: 3, label: "2 to 3 times a month", rate: 0.625 },
      { value: 4, label: "About once a week", rate: 1 },
      { value: 5, label: "Several times a week", rate: 3.5 },
      { value: 6, label: "Almost every morning", rate: 6.5 },
    ],
  },
};

export const assessmentIds: AssessmentId[] = ["ldfs", "madre"];

/** One saved answer. Holds no dream content, so it syncs with the other settings. */
export interface AssessmentAnswer { date: string; value: number }

export const MAX_ANSWERS = 60;

/** Adds an answer (one per day: a second answer the same day replaces the first), newest last, capped. */
export function addAnswer(list: readonly AssessmentAnswer[], a: AssessmentAnswer): AssessmentAnswer[] {
  return [...list.filter((x) => x.date !== a.date), a].sort((x, y) => x.date.localeCompare(y.date)).slice(-MAX_ANSWERS);
}

export function optionFor(id: AssessmentId, value: number) {
  return assessments[id].options.find((o) => o.value === value);
}
