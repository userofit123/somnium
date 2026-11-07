// Train's data (PLAN.md §6.4): the course's progress, today's practice ticks, the reality checks the move-on rules
// count, and tonight's plan (nights.techniques_planned of the night the coming morning is filed under). Nothing here
// is sealed (lesson ids, item ids, technique ids, dates), so ticks and lesson changes go through the outbox and wait
// for a connection like a logged check; tonight's plan uses the journal's own night handling.
import { useQuery } from "@tanstack/vue-query";
import { tonightOf, pmSetId, pmHitId, pmMissId, MEDITATION_HABIT, type CourseProgress, type PracticeLog, type RealityCheck, type Night, type WbtbModeLog } from "@somnium/shared";
import { uuidv7 } from "@somnium/engine/sealed-api";
import { api } from "./client";
import { send } from "./outbox";
import { invalidate } from "./live";
import { ensureNight, type NightRow } from "./journal";
import { localYmd } from "../core/format";

/** How far back the move-on rules look at checks and ticks: the longest rule runs 4 weeks, plus room. */
const WINDOW_DAYS = 60;

export function useTrain() {
  const from = new Date(Date.now() - WINDOW_DAYS * 86_400_000);
  return {
    course: useQuery({ queryKey: ["course"], queryFn: () => api.get<CourseProgress[]>("/course") }),
    practice: useQuery({ queryKey: ["practice", "train"], queryFn: () => api.get<PracticeLog[]>("/practice", { from: localYmd(from) }) }),
    checks: useQuery({ queryKey: ["checks", "train"], queryFn: () => api.get<RealityCheck[]>("/reality-checks", { from: from.toISOString(), limit: 2000 }) }),
  };
}

/** Ticks or unticks one practice item for a date. Unticking removes the row the tick made. */
export async function tickPractice(item: string, date: string, on: boolean, row?: PracticeLog) {
  if (on && !row) await send("post", "/practice", { id: uuidv7(), date, item, done: true });
  else if (!on && row) await send("del", `/practice/${row.id}`);
  invalidate(["practice"]);
}

/**
 * Sets a lesson's state. A lesson row is made on first touch; its own id is only sent then. Becoming active also
 * sends the start, which the engine keeps only when none is stored yet: the move-on rules count from it.
 */
export async function setLesson(lessonId: string, state: "active" | "done", known?: CourseProgress) {
  const now = new Date().toISOString();
  const body: Record<string, unknown> = { state, doneAt: state === "done" ? now : null };
  if (state === "active" && !known?.startedAt) body.startedAt = now;
  if (!known) body.id = uuidv7();
  await send("put", `/course/${encodeURIComponent(lessonId)}`, body);
  invalidate(["course"]);
}

/** The morning date tonight's night is filed under. */
export const tonightDate = (now = new Date()) => tonightOf(localYmd(now), now.getHours());

/** The night someone up in the small hours or the early morning is in: before noon it is the one ending today (a
 *  WBTB alarm at 05:30 or 06:30 belongs to last night, where tonightDate's 5 am turn would file it under the next). */
export const nightNowDate = (now = new Date()) => tonightOf(localYmd(now), now.getHours(), 12);

/** Tonight's night, if there is one yet. */
export const tonightNight = (nights: NightRow[] | undefined, date = tonightDate()) => nights?.find((n) => n.date === date && !n.nap);

/** Adds or removes a technique in tonight's plan, making tonight's night when there is none. */
export async function planTonight(technique: string, add: boolean) {
  const date = tonightDate();
  const id = await ensureNight(date, false, uuidv7());
  const night = await api.get<Night>(`/nights/${id}`);
  const cur = night.techniquesPlanned ?? [];
  const next = add ? (cur.includes(technique) ? cur : [...cur, technique]) : cur.filter((t) => t !== technique);
  if (next.length !== cur.length || next.some((t, i) => t !== cur[i])) await api.put(`/nights/${id}`, { techniquesPlanned: next });
  invalidate(["journal", "train", "home"]);
  return { date, id };
}

/**
 * WBTB from the planner (LDJ-25): the alarm time on tonight's night (plain: wbtb_wake_at) and "wbtb" in the plan. The
 * bedtime goes on the night only when the person chose one for tonight; the usual one stays in Settings.
 */
export async function planWbtb(wakeAt: Date, bedtime: Date | null, mode: WbtbModeLog | null = null) {
  const { date, id } = await planTonight("wbtb", true);
  // the mode (LDJ-49) goes on the night with the alarm, so "What works for you" can compare Short, Long and the nap
  const body: Record<string, unknown> = { wbtbWakeAt: wakeAt.toISOString(), wbtbMode: mode };
  if (bedtime) body.bedtime = bedtime.toISOString();
  await api.put(`/nights/${id}`, body);
  invalidate(["journal", "train", "home"]);
  return { date, id };
}

/** Clears tonight's WBTB alarm and takes "wbtb" out of the plan. */
export async function unplanWbtb() {
  const { id } = await planTonight("wbtb", false);
  await api.put(`/nights/${id}`, { wbtbWakeAt: null, wbtbMode: null });
  invalidate(["journal", "train", "home"]);
}

/** "Back to bed": the night was a WBTB night, with this many minutes up (0-600, the column's range). */
export async function backToBed(minutes: number, date = nightNowDate()) {
  const id = await ensureNight(date, false, uuidv7());
  await api.put(`/nights/${id}`, { wbtbUsed: true, wbtbMinutesAwake: Math.max(0, Math.min(600, Math.round(minutes))) });
  invalidate(["journal", "train", "home"]);
  return id;
}

/** A technique done on a night (techniques_done), e.g. "sound-cue" after a sleep-mode session (LDJ-48), and with
 *  `wbtbMode` the mode on the night (a CAT morning logs "cat", LDJ-49). Makes the night when there is none. */
export async function logTechniqueDone(technique: string, date = nightNowDate(), wbtbMode?: WbtbModeLog) {
  const id = await ensureNight(date, false, uuidv7());
  const night = await api.get<Night>(`/nights/${id}`);
  const cur = night.techniquesDone ?? [];
  const body: Record<string, unknown> = {};
  if (!cur.includes(technique)) body.techniquesDone = [...cur, technique];
  if (wbtbMode) body.wbtbMode = wbtbMode;
  if (Object.keys(body).length) await api.put(`/nights/${id}`, body);
  invalidate(["journal", "train", "home"]);
  return id;
}

// ---- Practice habits and prospective-memory targets (LDJ-26, LDJ-50) ----
// All of it is practice_log rows under the stable item ids of packages/shared/src/habits.ts: plain, nothing typed.

/** Streaks look back this far (the rows are small); the move-on rules' 60-day query above stays as it is. */
const HABIT_DAYS = 400;
export const useHabitLog = () => useQuery({
  queryKey: ["practice", "habits"],
  queryFn: () => api.get<PracticeLog[]>("/practice", { from: localYmd(new Date(Date.now() - HABIT_DAYS * 86_400_000)) }),
});

/** Sets or clears a prospective-memory target for a date; clearing also drops its hit or miss. */
export async function setPmTarget(date: string, target: string, on: boolean, rows: readonly PracticeLog[]) {
  const mine = rows.filter((r) => r.date === date && [pmSetId(target), pmHitId(target), pmMissId(target)].includes(r.item));
  if (on) { if (!mine.some((r) => r.item === pmSetId(target))) await send("post", "/practice", { id: uuidv7(), date, item: pmSetId(target), done: true }); }
  else for (const r of mine) await send("del", `/practice/${r.id}`);
  invalidate(["practice"]);
}

/** Logs a target as hit or miss (replacing the other); logging the same one again takes it back. */
export async function logPm(date: string, target: string, state: "hit" | "miss", rows: readonly PracticeLog[]) {
  const mine = rows.filter((r) => r.date === date && (r.item === pmHitId(target) || r.item === pmMissId(target)));
  const item = state === "hit" ? pmHitId(target) : pmMissId(target);
  for (const r of mine) await send("del", `/practice/${r.id}`);
  if (!mine.some((r) => r.item === item)) await send("post", "/practice", { id: uuidv7(), date, item, done: true });
  invalidate(["practice"]);
}

/** A finished meditation: today's habit row, with the minutes added to any earlier sit that day. */
export async function logMeditation(date: string, minutes: number, row?: PracticeLog) {
  if (row) await send("put", `/practice/${row.id}`, { minutes: Math.min(1440, (row.minutes ?? 0) + minutes), done: true });
  else await send("post", "/practice", { id: uuidv7(), date, item: MEDITATION_HABIT, done: true, minutes });
  invalidate(["practice"]);
}
