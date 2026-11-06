// Live updates: every change announces the topics it touches, and every screen's data is filed under topics.
// This file is the single place that says what affects what (PLAN.md §2). A new kind of change (a dream, a sign,
// a practice) is added here with every screen it can move.
export const TOPICS = {
  settings: ["settings", "home"],
  everything: ["*"],
} as const;
export type Change = keyof typeof TOPICS;
