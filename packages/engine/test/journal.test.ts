// The journal tables end to end on PGlite: a night, its dream, an element and the link; edits; soft delete; and
// above all that one person's rows are invisible to another, through the handlers and through raw SQL as the app role.
import { describe, it, expect, beforeAll } from "vitest";
import { createEngine, withUser, type Engine } from "../src/index";
import { pgliteDb } from "../src/adapters/pglite";
import { uuidv7 } from "../src/ids";

let eng: Engine;
let A: string, B: string;
const call = async (user: string, method: string, path: string, body?: unknown, query?: Record<string, string>) => {
  const r = await eng.handle({ method, path, body, query, userId: user });
  if (r.status !== 200) throw Object.assign(new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`), { status: r.status });
  return r.body as any;
};
const status = async (user: string, method: string, path: string, body?: unknown) => (await eng.handle({ method, path, body, userId: user })).status;

let night: any, dream: any, element: any;

beforeAll(async () => {
  eng = await createEngine(await pgliteDb("memory://"), { mode: "server" });
  A = uuidv7(); B = uuidv7();
  await eng.db.admin.query("INSERT INTO users (id, username, display_name) VALUES ($1,'a','A'), ($2,'b','B')", [A, B]);
}, 120000);

describe("journal", () => {
  it("writes a night, a dream, an element and the link between them", async () => {
    night = await call(A, "POST", "/nights", { date: "2026-11-05", sleepQuality: 4, techniquesPlanned: ["mild"], intention: "env:abc" });
    expect(night.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(night.techniquesPlanned).toEqual(["mild"]);
    dream = await call(A, "POST", "/dreams", { nightId: night.id, title: "env:t", text: "env:x", lucid: true, lucidityLevel: 3, vividness: 4, becameLucidHow: "dream_sign" });
    expect(dream.nightId).toBe(night.id);
    expect(dream.lucidityLevel).toBe(3);
    element = await call(A, "POST", "/elements", { kind: "character", name: "env:n", isDreamSign: true, signCategory: "form" });
    const link = await call(A, "POST", `/dreams/${dream.id}/elements`, { elementId: element.id, source: "manual", confidence: 0.9 });
    expect(link.elementId).toBe(element.id);
    // linking again updates the link there instead of making a second one
    await call(A, "POST", `/dreams/${dream.id}/elements`, { elementId: element.id, source: "detected" });
    const full = await call(A, "GET", `/dreams/${dream.id}`);
    expect(full.elements).toHaveLength(1);
    expect(full.elements[0].source).toBe("detected");
    const nights = await call(A, "GET", "/nights");
    expect(nights[0].dreamCount).toBe(1);
    expect(nights[0].lucidCount).toBe(1);
  });

  it("refuses values off the scales and unknown enum words", async () => {
    expect(await status(A, "POST", "/dreams", { nightId: night.id, lucidityLevel: 6 })).toBe(400);
    expect(await status(A, "POST", "/dreams", { nightId: night.id, wakeMethod: "parachute" })).toBe(400);
    expect(await status(A, "POST", "/nights", {})).toBe(400);
  });

  it("updates part of a row and keeps the rest", async () => {
    const d = await call(A, "PUT", `/dreams/${dream.id}`, { control: 2, favourite: true });
    expect(d.control).toBe(2);
    expect(d.title).toBe("env:t");
    expect(d.lucidityLevel).toBe(3);
    expect(new Date(d.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(d.createdAt).getTime());
  });

  it("never takes user_id from the body", async () => {
    const d = await call(A, "POST", "/dreams", { nightId: night.id, userId: B, user_id: B });
    const owner = (await eng.db.admin.query("SELECT user_id FROM dreams WHERE id = $1", [d.id])).rows[0].user_id;
    expect(owner).toBe(A);
  });

  it("logs reality checks, practice, the course, goals and reminders", async () => {
    const c = await call(A, "POST", "/reality-checks", { kind: "hands", outcome: "awake", prompted: true });
    expect((await call(A, "GET", "/reality-checks"))[0].id).toBe(c.id);
    await call(A, "POST", "/practice", { date: "2026-11-05", item: "mild", minutes: 10 });
    expect(await call(A, "GET", "/practice", undefined, { from: "2026-11-01", to: "2026-11-30" })).toHaveLength(1);
    const l = await call(A, "PUT", "/course/lesson-1", { state: "done", doneAt: "2026-11-05T07:00:00Z" });
    expect((await call(A, "PUT", "/course/lesson-1", { answers: "env:q" })).id).toBe(l.id);
    expect(await call(A, "GET", "/course")).toHaveLength(1);
    const g = await call(A, "POST", "/goals", { kind: "recall_per_week", target: 5 });
    expect(g.period).toBe("week");
    const rem = await call(A, "POST", "/reminders", { kind: "reality_check", schedule: { every: 90 } });
    expect(rem.enabled).toBe(true);
    expect(rem.schedule).toEqual({ every: 90 });
    expect(await status(A, "POST", "/goals", { kind: "steps" })).toBe(400);
  });

  it("keeps one person's rows from another", async () => {
    expect(await status(B, "GET", `/nights/${night.id}`)).toBe(404);
    expect(await status(B, "GET", `/dreams/${dream.id}`)).toBe(404);
    expect(await status(B, "PUT", `/dreams/${dream.id}`, { lucid: false })).toBe(404);
    expect(await status(B, "DELETE", `/elements/${element.id}`)).toBe(404);
    expect(await status(B, "POST", "/dreams", { nightId: night.id })).toBe(400);
    expect(await call(B, "GET", "/nights")).toEqual([]);
    expect(await call(B, "GET", "/dreams")).toEqual([]);
    expect(await call(B, "GET", "/elements")).toEqual([]);
    expect(await call(B, "GET", "/reality-checks")).toEqual([]);
    // the database itself refuses, even to a query that forgets WHERE user_id
    for (const t of ["nights", "dreams", "elements", "dream_elements", "reality_checks", "practice_log", "course_progress", "goals", "reminders"]) {
      const n = await withUser(eng.db, B, async (q) => (await q.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n);
      expect(n, t).toBe(0);
      const mine = await withUser(eng.db, A, async (q) => (await q.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n);
      expect(mine, t).toBeGreaterThan(0);
    }
    const stolen = await withUser(eng.db, B, async (q) => (await q.query("UPDATE dreams SET lucid = false WHERE id = $1 RETURNING id", [dream.id])).rows.length);
    expect(stolen).toBe(0);
  });

  it("exports the journal and restores it", async () => {
    const out = await call(A, "GET", "/export");
    expect(out.tables.dreams).toHaveLength(2);
    expect(out.tables.dream_elements).toHaveLength(1);
    expect(out.tables.dreams[0].user_id).toBeUndefined();
    const counts = await call(A, "POST", "/import", { data: out, mode: "replace" });
    expect(counts.dreams).toBe(2);
    expect(await call(A, "GET", "/dreams")).toHaveLength(2);
    expect((await call(A, "GET", `/dreams/${dream.id}`)).elements).toHaveLength(1);
  });

  it("deletes by marking, and the marked rows stay out of sight", async () => {
    await call(A, "DELETE", `/dreams/${dream.id}`);
    expect(await status(A, "GET", `/dreams/${dream.id}`)).toBe(404);
    expect(await status(A, "PUT", `/dreams/${dream.id}`, { lucid: false })).toBe(404);
    expect(await status(A, "DELETE", `/dreams/${dream.id}`)).toBe(404);
    const row = (await eng.db.admin.query("SELECT deleted_at FROM dreams WHERE id = $1", [dream.id])).rows[0];
    expect(row.deleted_at).not.toBeNull();
    expect((await call(A, "GET", `/elements/${element.id}`)).dreams).toEqual([]);
    await call(A, "DELETE", `/nights/${night.id}`);
    expect(await call(A, "GET", "/dreams")).toEqual([]);
    expect(await call(A, "GET", "/nights")).toEqual([]);
  });
});
