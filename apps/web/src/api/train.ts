// Train's data (PLAN.md §6.4): the course's progress, today's practice ticks, the reality checks the move-on rules
// count, and tonight's plan (nights.techniques_planned of the night the coming morning is filed under). Nothing here
// is sealed (lesson ids, item ids, technique ids, dates), so ticks and lesson changes go through the outbox and wait
// for a connection like a logged check; tonight's plan uses the journal's own night handling.
import { useQuery } from "@tanstack/vue-query";
import { tonightOf, type CourseProgress, type PracticeLog, type RealityCheck, type Night } from "@somnium/shared";
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

/** Sets a lesson's state. A lesson row is made on first touch; its own id is only sent then. */
export async function setLesson(lessonId: string, state: "active" | "done", known?: CourseProgress) {
  const body: Record<string, unknown> = { state, doneAt: state === "done" ? new Date().toISOString() : null };
  if (!known) body.id = uuidv7();
  await send("put", `/course/${encodeURIComponent(lessonId)}`, body);
  invalidate(["course"]);
}

/** The morning date tonight's night is filed under. */
export const tonightDate = (now = new Date()) => tonightOf(localYmd(now), now.getHours());

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
