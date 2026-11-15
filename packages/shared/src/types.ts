// The shapes the API sends and receives. The journal's own shapes mirror their tables (PLAN.md §5, migration 004).
// Fields marked sealed hold the envelope string the device made (PLAN.md §4): the server never sees the plain text.

export interface Me {
  id: string;
  username: string;
  displayName: string;
  role: "admin" | "user";
  mode: "server" | "local";
}

export interface LiveEvent {
  topics: string[];
  at: number;
}

/** Every user row: who owns it, when it was made and changed, and when it was removed (soft delete, for sync). */
export interface Owned {
  id: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export const BECAME_LUCID_HOW = ["dream_sign", "reality_check", "wild", "spontaneous", "nightmare", "other"] as const;
export type BecameLucidHow = (typeof BECAME_LUCID_HOW)[number];
export const WAKE_METHODS = ["alarm", "natural", "wbtb"] as const;
/** How a lucid dream ended (LDJ-78): woke up, lost lucidity but kept dreaming, faded out, or still lucid at waking. */
export const LUCID_ENDS = ["woke", "lost", "faded", "still_going"] as const;
export type LucidEnd = (typeof LUCID_ENDS)[number];
export type WakeMethod = (typeof WAKE_METHODS)[number];
export const ELEMENT_KINDS = ["character", "place", "object", "action", "emotion", "theme", "sensation", "dream_sign"] as const;
export type ElementKind = (typeof ELEMENT_KINDS)[number];
/** LaBerge's four dream-sign categories (RESEARCH.md). */
export const SIGN_CATEGORIES = ["inner_awareness", "action", "form", "context"] as const;
export type SignCategory = (typeof SIGN_CATEGORIES)[number];
export const ELEMENT_SOURCES = ["manual", "detected", "ocr"] as const;
export type ElementSource = (typeof ELEMENT_SOURCES)[number];
export const MEDIA_KINDS = ["photo", "sketch", "audio", "video"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];
export const CHECK_KINDS = ["nose", "hands", "text", "clock", "light", "jump", "finger_palm", "other"] as const;
export type CheckKind = (typeof CHECK_KINDS)[number];
export const CHECK_OUTCOMES = ["awake", "unsure", "dreaming"] as const;
export type CheckOutcome = (typeof CHECK_OUTCOMES)[number];
export const LESSON_STATES = ["open", "active", "done", "skipped"] as const;
export type LessonState = (typeof LESSON_STATES)[number];
export const GOAL_KINDS = ["recall_per_week", "lucid_per_month", "checks_per_day", "journal_streak"] as const;
export type GoalKind = (typeof GOAL_KINDS)[number];
export const GOAL_PERIODS = ["day", "week", "month"] as const;
export type GoalPeriod = (typeof GOAL_PERIODS)[number];
export const REMINDER_KINDS = ["reality_check", "bedtime", "wbtb", "morning_journal", "practice", "custom"] as const;
export type ReminderKind = (typeof REMINDER_KINDS)[number];

/** One night, filed under the morning's date (YYYY-MM-DD). */
export interface Night extends Owned {
  date: string;
  bedtime: string | null;
  wakeTime: string | null;
  sleepQuality: number | null; // 1-5
  wbtbUsed: boolean;
  wbtbWakeAt: string | null;
  wbtbMinutesAwake: number | null;
  /** the WBTB mode used: "short" | "long" | "nap" | "cat" (guided.ts WBTB_MODE_LOG) */
  wbtbMode?: string | null;
  /** minutes to fall asleep after the technique, sealed: whole minutes as text once opened (rates.ts minutesToSleep) */
  minutesToSleep?: string | null;
  nap: boolean;
  substances: string | null; // sealed
  caffeineAfter: string | null; // HH:MM:SS
  alcohol: boolean;
  notes: string | null; // sealed
  techniquesPlanned: string[];
  techniquesDone: string[];
  intention: string | null; // sealed
  /** "No recall" said in so many words: a night without dreams counts as logged only with this or its details. */
  noRecall: boolean;
}

export interface Dream extends Owned {
  nightId: string;
  position: number;
  title: string | null; // sealed
  text: string | null; // sealed
  lucid: boolean;
  lucidityLevel: number; // 0-5 (PLAN.md §7.4)
  /** Dreamsign Awareness Scale 0-4 (LDJ-50), a plain number */
  awareness: number | null;
  control: number | null; // 0-5
  vividness: number | null; // 1-5
  recallClarity: number | null; // 1-5
  emotionOverall: number | null; // -2..2
  /** how long it was lucid, in minutes (the editor's chips, journal.ts LUCID_LENGTHS) */
  durationEst: number | null;
  /** upsetting enough to wake you (Zadra and Donderi 2000, RESEARCH.md C18); never with badDream */
  nightmare: boolean;
  /** upsetting, but you slept on (C18); never with nightmare */
  badDream: boolean;
  recurring: boolean;
  falseAwakening: boolean;
  sleepParalysis: boolean;
  becameLucidHow: BecameLucidHow | null;
  /** what tipped you off, one line */
  lucidTrigger: string | null; // sealed
  /** how the lucid part ended (LUCID_ENDS); absent on rows from before migration 020 */
  lucidEnd?: LucidEnd | null;
  wakeMethod: WakeMethod | null;
  favourite: boolean;
  /** saved from the morning capture as key words only, to write out later (LDJ-80); absent before migration 021 */
  unfinished?: boolean;
  /** suggestion keys dismissed for this dream, a JSON list (LDJ-18) */
  dismissed: string | null; // sealed
}

export interface Element extends Owned {
  kind: ElementKind;
  name: string | null; // sealed
  aliases: string | null; // sealed
  colour: string | null;
  note: string | null; // sealed
  /** a dream sign's waking triggers, one per line ("when I see a teacher"), checked at in the day (LDJ-111) */
  triggers?: string | null; // sealed
  isDreamSign: boolean;
  signCategory: SignCategory | null;
  confirmed: boolean;
}

export interface DreamElement extends Owned {
  dreamId: string;
  elementId: string;
  source: ElementSource;
  confidence: number | null; // 0-1
  span: string | null; // sealed
}

export interface Media extends Owned {
  dreamId: string | null;
  kind: MediaKind;
  mime: string;
  size: number;
  path: string | null;
  ocrText: string | null; // sealed
  duration: number | null; // seconds
}

export interface RealityCheck extends Owned {
  at: string;
  kind: CheckKind;
  outcome: CheckOutcome;
  prompted: boolean;
  note: string | null; // sealed
  signId?: string | null; // the dream sign (element id) the reminder paired it with (LDJ-111)
}

export interface PracticeLog extends Owned {
  date: string;
  item: string; // lesson, technique or habit id
  done: boolean;
  minutes: number | null;
  note: string | null; // sealed
}

export interface CourseProgress extends Owned {
  lessonId: string;
  state: LessonState;
  doneAt: string | null;
  /** When the lesson became the current one; set once, never moved (the move-on rules count from it). */
  startedAt: string | null;
  answers: string | null; // sealed
}

/** A short note about a day (LDJ-41), sealed; the date is the calendar day it is about. */
export interface DayNote extends Owned {
  date: string;
  text: string | null; // sealed
}

export interface Goal extends Owned {
  kind: GoalKind;
  target: number;
  period: GoalPeriod;
}

export interface Reminder extends Owned {
  kind: ReminderKind;
  schedule: Record<string, unknown>;
  enabled: boolean;
}
