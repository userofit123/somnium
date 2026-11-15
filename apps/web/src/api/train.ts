// Train's data (PLAN.md §6.4): the course's progress, today's practice ticks, the reality checks the move-on rules
// count, and tonight's plan (nights.techniques_planned of the night the coming morning is filed under). Nothing here
// is sealed (lesson ids, item ids, technique ids, dates), so ticks, lesson changes and tonight's plan go through the
// outbox and wait for a connection like a logged check.
import { useQuery } from "@tanstack/vue-query";
import { nightOfDate, tonightOf, pmSetId, pmHitId, pmMissId, MEDITATION_HABIT, type CourseProgress, type PracticeLog, type RealityCheck, type Night, type WbtbModeLog } from "@somnium/shared";
import { uuidv7 } from "@somnium/engine/sealed-api";
import { api, ApiError } from "./client";
import { send } from "./outbox";
import { invalidate, queryClient } from "./live";
import { ensureNight, onDevice, type NightRow } from "./journal";
import { localYmd } from "../core/format";
import { readJson, writeJson } from "../core/prefs";

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

// Tonight's plan and the WBTB fields are plain columns of nights (packages/engine/src/sealed.ts lists none of them), so
// like a tick they go through the outbox: with no connection on the direct path the change waits on this device and
// is sent when the server is back, and the screens show it at once. With the device copy the outbox sends it there.
const NIGHTS = ["journal", "nights"];
// no connection, or the journal key isn't open: the outbox's own test (api/outbox.ts mustWait)
const mustWait = (e: unknown) => (e instanceof ApiError && e.status === 0) || (e as Error)?.name === "LockedError";

/** The change on the night in the lists the screens read, before the server has it (a night made here is added).
 *  Offline (`seed`) a list not loaded yet is started with it, so the next change offline builds on this one. */
function showOnNight(id: string, date: string, body: Partial<Night>, seed = false) {
  void queryClient.cancelQueries({ queryKey: NIGHTS });
  queryClient.setQueryData<NightRow[]>(NIGHTS, (loaded) => {
    if (!loaded && !seed) return loaded;
    const ns = loaded ?? [];
    if (ns.some((n) => n.id === id)) return ns.map((n) => (n.id === id ? { ...n, ...body } : n));
    const made = { id, date, nap: false, techniquesPlanned: [], techniquesDone: [], wbtbUsed: false, alcohol: false, noRecall: false, dreamCount: 0, lucidCount: 0, ...body } as unknown as NightRow;
    return [made, ...ns];
  });
}

// The nights this device made while it had no connection, by date: a second change to the same date before the
// server has the first must go to that night, not queue a second create with a new id (the server would refuse it as
// a second night of the date, and the changes queued for it would find no night). Kept in storage so a reload in
// between still knows; a date and a random id, nothing personal. Dropped once the server answers with that night.
const MADE_KEY = "somniumNightsMadeOffline";
const madeOffline = () => readJson<Record<string, string>>(MADE_KEY, {});
function rememberMade(date: string, id: string | null) {
  const m = madeOffline();
  if (id) m[date] = id; else delete m[date];
  // only the last few dates matter: tonight's and last night's
  writeJson(MADE_KEY, Object.fromEntries(Object.entries(m).sort(([a], [b]) => a.localeCompare(b)).slice(-8)));
}

/**
 * Changes plain fields on the night of a date, making the night when there is none. `change` gets the night as it is
 * and answers the fields to change ({} for none). Without a connection on the direct path the night is the one this
 * device last saw or made; a night not seen yet is made by a queued create with the id ensureNight was asked for, so a
 * create that reached the server before the connection went is answered as the same row (rows.ts sameCreate), not a
 * 409. (Not journal.ts changeNight, which changes the night of a dream being written.)
 */
async function changeNightPlan(date: string, change: (n: Night | undefined) => Partial<Night>): Promise<string> {
  const made = madeOffline()[date];
  // a night made offline and not sent yet is asked for with its own id, so it isn't made twice when the server is back
  const wanted = made ?? uuidv7();
  let night: Night | undefined;
  let offline = false;
  try {
    night = await api.get<Night>(`/nights/${await ensureNight(date, false, wanted)}`);
    if (made) rememberMade(date, null);
  } catch (e) {
    if (!mustWait(e) || onDevice()) throw e;
    offline = true;
    night = nightOfDate(queryClient.getQueryData<NightRow[]>(NIGHTS) ?? [], date);
    if (!night && !made) { await send("post", "/nights", { id: wanted, date, nap: false }); rememberMade(date, wanted); }
  }
  const id = night?.id ?? wanted;
  const body = change(night);
  if (Object.keys(body).length) await send("put", `/nights/${id}`, body);
  showOnNight(id, date, body, offline);
  invalidate(["journal", "train", "home"]);
  return id;
}

/** Adds or removes a technique in tonight's plan, making tonight's night when there is none. */
export async function planTonight(technique: string, add: boolean) {
  const date = tonightDate();
  const id = await changeNightPlan(date, (n) => {
    const cur = n?.techniquesPlanned ?? [];
    const next = add ? (cur.includes(technique) ? cur : [...cur, technique]) : cur.filter((t) => t !== technique);
    return next.length !== cur.length || next.some((t, i) => t !== cur[i]) ? { techniquesPlanned: next } : {};
  });
  return { date, id };
}

/**
 * WBTB from the planner (LDJ-25): the alarm time on tonight's night (plain: wbtb_wake_at) and "wbtb" in the plan. The
 * bedtime goes on the night only when the person chose one for tonight; the usual one stays in Settings.
 */
export async function planWbtb(wakeAt: Date, bedtime: Date | null, mode: WbtbModeLog | null = null) {
  const date = tonightDate();
  // the mode (LDJ-49) goes on the night with the alarm, so "What works for you" can compare Short, Long and the nap
  const id = await changeNightPlan(date, (n) => {
    const cur = n?.techniquesPlanned ?? [];
    const body: Partial<Night> = { wbtbWakeAt: wakeAt.toISOString(), wbtbMode: mode };
    if (!cur.includes("wbtb")) body.techniquesPlanned = [...cur, "wbtb"];
    if (bedtime) body.bedtime = bedtime.toISOString();
    return body;
  });
  return { date, id };
}

/** Tonight's own bedtime (Train > Tonight), or with null the usual one from Settings > Sleep again. The bedtime
 *  reminder follows it (native/reminders.ts); a WBTB alarm already planned keeps its time until planned again. */
export async function setTonightBedtime(at: Date | null) {
  await changeNightPlan(tonightDate(), (n) => {
    const iso = at ? at.toISOString() : null;
    return (n?.bedtime ?? null) === iso ? {} : { bedtime: iso };
  });
}

/** Clears tonight's WBTB alarm and takes "wbtb" out of the plan. */
export async function unplanWbtb() {
  await changeNightPlan(tonightDate(), (n) => ({ techniquesPlanned: (n?.techniquesPlanned ?? []).filter((t) => t !== "wbtb"), wbtbWakeAt: null, wbtbMode: null }));
}

/** "Back to bed": the night was a WBTB night, with this many minutes up (0-600, the column's range). */
export async function backToBed(minutes: number, date = nightNowDate()) {
  return changeNightPlan(date, () => ({ wbtbUsed: true, wbtbMinutesAwake: Math.max(0, Math.min(600, Math.round(minutes))) }));
}

/** A technique done on a night (techniques_done), e.g. "sound-cue" after a sleep-mode session (LDJ-48), and with
 *  `wbtbMode` the mode on the night (a CAT morning logs "cat", LDJ-49). Makes the night when there is none. */
export async function logTechniqueDone(technique: string, date = nightNowDate(), wbtbMode?: WbtbModeLog) {
  return changeNightPlan(date, (n) => {
    const cur = n?.techniquesDone ?? [];
    const body: Partial<Night> = {};
    if (!cur.includes(technique)) body.techniquesDone = [...cur, technique];
    if (wbtbMode) body.wbtbMode = wbtbMode;
    return body;
  });
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
