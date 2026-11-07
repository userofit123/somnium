// Training: the practice log (a day's lessons, techniques and habits), progress through the course, goals and
// reminders (PLAN.md §5, §6.4, §8, §9). The course's content and the recommendation rules live elsewhere.
import { practiceItemOk, LESSON_STATES, GOAL_KINDS, GOAL_PERIODS, REMINDER_KINDS, storableSchedule, type PracticeLog, type CourseProgress, type Goal, type Reminder, type DayNote } from "@somnium/shared";
import type { Router } from "../router";
import { id, str, intOrNull, bool, dateStr } from "../util";
import { clientId, refuseOtherRow, columns, sealed, timeOrNull, enumOrNull, enumOf, required, json, listLive, getLive, insertRow, updateRow, removeRow, type Fields } from "./rows";
import { bad, conflict, notFound } from "../errors";

const PRACTICE: Fields = {
  date: required(dateStr, "date"),
  // habit and memory-target ids only from their fixed lists (packages/shared/src/habits.ts): a typed target would be
  // personal text in a plain column
  item: required((v) => { if (v == null || v === "") return null; const s = str(v, 80); if (!practiceItemOk(s)) throw bad("Unknown practice item"); return s; }, "item"),
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
// the table is plain (not sealed): the schedule keeps only times, numbers and values from fixed lists (storableSchedule),
// so free text sent by any client never lands in it
const REMINDER: Fields = { kind: required(enumOrNull(REMINDER_KINDS), "kind"), schedule: (v) => json(v && typeof v === "object" && !Array.isArray(v) ? storableSchedule(v as Record<string, unknown>) : v), enabled: (v) => bool(v, true) };

const DAY_NOTE: Fields = { date: required(dateStr, "date"), text: sealed };

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

  // day notes (LDJ-41): a sealed line about a day, for the dream-lag analysis
  r.get("/day-notes", async ({ q }, _p, _b, qs) => {
    const params: unknown[] = [], w: string[] = [];
    const from = dateStr(qs.from), to = dateStr(qs.to);
    if (from) { params.push(from); w.push(`date >= $${params.length}`); }
    if (to) { params.push(to); w.push(`date <= $${params.length}`); }
    return listLive<DayNote>(q, "day_notes", w.join(" AND "), params, "date DESC", 2000);
  });
  // one live note per date (migration 017): a second one is refused, not merged, since its text is sealed to its own id;
  // the screens then write to the note that is there
  const dateTaken = async (q: { query: (s: string, a: unknown[]) => Promise<{ rows: unknown[] }> }, date: unknown, not: string | null) => {
    if (date == null) return;
    const r = await q.query("SELECT 1 FROM day_notes WHERE date = $1 AND deleted_at IS NULL AND id IS DISTINCT FROM $2::uuid LIMIT 1", [date, not]);
    if (r.rows.length) throw conflict("There's already a note for that date");
  };
  r.post("/day-notes", async (ctx, _p, b) => {
    const cols: Record<string, unknown> = { ...columns(DAY_NOTE, b, true), ...clientId(b) };
    // the same note sent again (the device's id) is insertRow's to answer
    await dateTaken(ctx.q, cols.date, typeof cols.id === "string" ? cols.id : null);
    return insertRow<DayNote>(ctx, "day_notes", "dayNotes", cols);
  });
  r.put("/day-notes/:id", async (ctx, p, b) => {
    const cols = columns(DAY_NOTE, b, false);
    await dateTaken(ctx.q, cols.date, id(p.id));
    return updateRow<DayNote>(ctx, "day_notes", "dayNotes", id(p.id), cols, "day note");
  });
  r.del("/day-notes/:id", async (ctx, p) => { await removeRow(ctx, "day_notes", "dayNotes", id(p.id), "day note"); return { ok: true }; });

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
