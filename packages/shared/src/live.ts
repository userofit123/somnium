// Live updates: every change announces the topics it touches, and every screen's data is filed under topics.
// This file is the single place that says what affects what (PLAN.md §2). A new kind of change (a dream, a sign,
// a practice) is added here with every screen it can move.
export const TOPICS = {
  settings: ["settings", "home"],
  nights: ["nights", "journal", "insights", "home"],
  dreams: ["dreams", "journal", "signs", "insights", "home"],
  elements: ["elements", "signs", "journal", "insights"],
  checks: ["checks", "train", "insights", "home"],
  practice: ["practice", "train", "home"],
  course: ["course", "train", "learn", "home"],
  goals: ["goals", "insights", "home"],
  dayNotes: ["dayNotes", "insights", "home", "journal"],
  reminders: ["reminders", "train", "settings"],
  everything: ["*"],
} as const;
export type Change = keyof typeof TOPICS;
