// Training: the practice log (a day's lessons, techniques and habits), progress through the course, goals and
// reminders (PLAN.md §5, §6.4, §8, §9). The course's content and the recommendation rules live elsewhere.
import { LESSON_STATES, GOAL_KINDS, GOAL_PERIODS, REMINDER_KINDS, type PracticeLog, type CourseProgress, type Goal, type Reminder } from "@somnium/shared";
import type { Router } from "../router";
import { id, str, intOrNull, bool, dateStr } from "../util";
import { clientId, refuseOtherRow, columns, sealed, timeOrNull, enumOrNull, enumOf, required, json, listLive, getLive, insertRow, updateRow, removeRow, type Fields } from "./rows";
import { notFound } from "../errors";

const PRACTICE: Fields = {
  date: required(dateStr, "date"),
  item: required((v) => (v == null || v === "" ? null : str(v, 80)), "item"),
  done: (v) => bool(v, true),
  minutes: (v) => intOrNull(v, 0, 1440),
  note: sealed,
};
const LESSON: Fields = { state: enumOf(LESSON_STATES, "open"), done_at: timeOrNull, started_at: timeOrNull, answers: sealed };
const GOAL: Fields = {
  kind: required(enumOrNull(GOAL_KINDS), "kind"),
  target: required((v) => intOrNull(v, 1, 1000), "target"),
  period: enumOf(GOAL_PERIODS, "week"),
};
const REMINDER: Fields = { kind: required(enumOrNull(REMINDER_KINDS), "kind"), schedule: json, enabled: (v) => bool(v, true) };

export function practiceRoutes(r: Router) {
  r.get("/practice", async ({ q }, _p, _b, qs) => {
    const w: string[] = [], params: unknown[] = [];
    const from = dateStr(qs.from), to = dateStr(qs.to);
    if (from) { params.push(from); w.push(`date >= $${params.length}`); }
    if (to) { params.push(to); w.push(`date <= $${params.length}`); }
    return listLive<PracticeLog>(q, "practice_log", w.join(" AND "), params, "date DESC, created_at DESC", 2000);
  });
  r.get("/practice/:id", async ({ q }, p) => getLive<PracticeLog>(q, "practice_log", id(p.id), "practice entry"));
  r.post("/practice", async (ctx, _p, b) => insertRow<PracticeLog>(ctx, "practice_log", "practice", { ...columns(PRACTICE, b, true), ...clientId(b) }));
  r.put("/practice/:id", async (ctx, p, b) => updateRow<PracticeLog>(ctx, "practice_log", "practice", id(p.id), columns(PRACTICE, b, false), "practice entry"));
  r.del("/practice/:id", async (ctx, p) => { await removeRow(ctx, "practice_log", "practice", id(p.id), "practice entry"); return { ok: true }; });

  // the course: one row per lesson, written by its lesson id (the bundled content's), made on first touch
  r.get("/course", async ({ q }) => listLive<CourseProgress>(q, "course_progress", "", [], "created_at", 1000));
  r.put("/course/:lessonId", async (ctx, p, b) => {
    const lessonId = str(p.lessonId, 80);
    const cur = (await ctx.q.query<{ id: string; started_at: unknown }>("SELECT id, started_at FROM course_progress WHERE lesson_id = $1 AND deleted_at IS NULL", [lessonId])).rows[0];
    const cols = columns(LESSON, b, !cur);
    if (cur) refuseOtherRow(ctx, "course_progress", b, cols, cur.id);
    // the start is set once, when the lesson first becomes active, and never moves: the move-on rules count from it
    if (cur?.started_at != null) delete cols.started_at;
    else if (cols.started_at == null) { if (cols.state === "active") cols.started_at = new Date().toISOString(); else delete cols.started_at; }
    return cur
      ? updateRow<CourseProgress>(ctx, "course_progress", "course", cur.id, cols, "lesson")
      : insertRow<CourseProgress>(ctx, "course_progress", "course", { lesson_id: lessonId, ...cols, ...clientId(b) });
  });
  r.del("/course/:lessonId", async (ctx, p) => {
    const cur = (await ctx.q.query<{ id: string }>("SELECT id FROM course_progress WHERE lesson_id = $1 AND deleted_at IS NULL", [str(p.lessonId, 80)])).rows[0];
    if (!cur) throw notFound("Unknown lesson");
    await removeRow(ctx, "course_progress", "course", cur.id, "lesson");
    return { ok: true };
  });

  r.get("/goals", async ({ q }) => listLive<Goal>(q, "goals", "", [], "created_at"));
  r.post("/goals", async (ctx, _p, b) => insertRow<Goal>(ctx, "goals", "goals", { ...columns(GOAL, b, true), ...clientId(b) }));
  r.put("/goals/:id", async (ctx, p, b) => updateRow<Goal>(ctx, "goals", "goals", id(p.id), columns(GOAL, b, false), "goal"));
  r.del("/goals/:id", async (ctx, p) => { await removeRow(ctx, "goals", "goals", id(p.id), "goal"); return { ok: true }; });

  r.get("/reminders", async ({ q }) => listLive<Reminder>(q, "reminders", "", [], "created_at"));
  // the device's id is taken, so a reminder sent again from the outbox hits the row it made (rows.ts sameCreate)
  r.post("/reminders", async (ctx, _p, b) => insertRow<Reminder>(ctx, "reminders", "reminders", { ...columns(REMINDER, b, true), ...clientId(b) }));
  r.put("/reminders/:id", async (ctx, p, b) => updateRow<Reminder>(ctx, "reminders", "reminders", id(p.id), columns(REMINDER, b, false), "reminder"));
  r.del("/reminders/:id", async (ctx, p) => { await removeRow(ctx, "reminders", "reminders", id(p.id), "reminder"); return { ok: true }; });
}
