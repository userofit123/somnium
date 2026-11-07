// The journal tables end to end on PGlite: a night, its dream, an element and the link; edits; soft delete; and
// above all that one person's rows are invisible to another, through the handlers and through raw SQL as the app role.
import { describe, it, expect, beforeAll } from "vitest";
import type { Night, Dream, Element, DreamElement, RealityCheck, CourseProgress, Goal, Reminder } from "@somnium/shared";
import { createEngine, withUser, type Engine } from "../src/index";
import { pgliteDb } from "../src/adapters/pglite";
import { uuidv7 } from "../src/ids";

let eng: Engine;
let A: string, B: string;
const call = async <T = unknown>(user: string, method: string, path: string, body?: unknown, query?: Record<string, string>): Promise<T> => {
  const r = await eng.handle({ method, path, body, query, userId: user });
  if (r.status !== 200) throw Object.assign(new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`), { status: r.status });
  return r.body as T;
};
const status = async (user: string, method: string, path: string, body?: unknown) => (await eng.handle({ method, path, body, userId: user })).status;
/** The topics the engine announced while fn ran. */
async function announced(fn: () => Promise<unknown>): Promise<string[]> {
  const topics: string[] = [];
  const off = eng.onChange((_u, t) => topics.push(...t));
  try { await fn(); } finally { off(); }
  return topics;
}

type NightRow = Night & { dreamCount: number; lucidCount: number };
type DreamFull = Dream & { elements: DreamElement[] };
type ElementFull = Element & { dreams: DreamElement[] };
type Export = { tables: Record<string, Record<string, unknown>[]> };

let night: Night, dream: Dream, element: Element;

beforeAll(async () => {
  // the handlers themselves, on a device: what a server refuses (plaintext in sealed columns) is in sealing.test.ts
  eng = await createEngine(await pgliteDb("memory://"), { mode: "local" });
  A = uuidv7(); B = uuidv7();
  await eng.db.admin.query("INSERT INTO users (id, username, display_name) VALUES ($1,'a','A'), ($2,'b','B')", [A, B]);
}, 120000);

describe("journal", () => {
  it("writes a night, a dream, an element and the link between them", async () => {
    night = await call<Night>(A, "POST", "/nights", { date: "2026-11-05", sleepQuality: 4, techniquesPlanned: ["mild"], intention: "env:abc" });
    expect(night.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(night.techniquesPlanned).toEqual(["mild"]);
    dream = await call<Dream>(A, "POST", "/dreams", { nightId: night.id, title: "env:t", text: "env:x", lucid: true, lucidityLevel: 3, vividness: 4, becameLucidHow: "dream_sign" });
    expect(dream.nightId).toBe(night.id);
    expect(dream.lucidityLevel).toBe(3);
    element = await call<Element>(A, "POST", "/elements", { kind: "character", name: "env:n", isDreamSign: true, signCategory: "form" });
    const link = await call<DreamElement>(A, "POST", `/dreams/${dream.id}/elements`, { elementId: element.id, source: "manual", confidence: 0.9 });
    expect(link.elementId).toBe(element.id);
    // every link at once, for the Journal's counts and element search; never another person's
    expect((await call<DreamElement[]>(A, "GET", "/dream-elements")).map((l) => l.id)).toContain(link.id);
    expect(await call<DreamElement[]>(B, "GET", "/dream-elements")).toEqual([]);
    // linking again updates the link there instead of making a second one
    await call(A, "POST", `/dreams/${dream.id}/elements`, { elementId: element.id, source: "detected" });
    const full = await call<DreamFull>(A, "GET", `/dreams/${dream.id}`);
    expect(full.elements).toHaveLength(1);
    expect(full.elements[0]!.source).toBe("detected");
    const nights = await call<NightRow[]>(A, "GET", "/nights");
    expect(nights[0]!.dreamCount).toBe(1);
    expect(nights[0]!.lucidCount).toBe(1);
  });

  it("takes the minutes to fall asleep as whole minutes and keeps them as text (a sealed column)", async () => {
    expect((await call<Night>(A, "PUT", `/nights/${night.id}`, { minutesToSleep: 15 })).minutesToSleep).toBe("15");
    expect((await call<Night>(A, "PUT", `/nights/${night.id}`, { minutesToSleep: "5" })).minutesToSleep).toBe("5");
    for (const v of [-1, 601, 2.5, "soon"]) expect(await status(A, "PUT", `/nights/${night.id}`, { minutesToSleep: v })).toBe(400);
    expect(await announced(() => call(A, "PUT", `/nights/${night.id}`, { minutesToSleep: null }))).toContain("nights");
  });

  it("lists every dream's plain facts with no limit and nothing sealed", async () => {
    const facts = await call<Record<string, unknown>[]>(A, "GET", "/dream-facts");
    const mine = facts.find((f) => f.id === dream.id)!;
    expect(mine).toMatchObject({ nightId: night.id, date: "2026-11-05", nap: false, lucid: true, lucidityLevel: 3, becameLucidHow: "dream_sign" });
    expect(Object.keys(mine)).not.toContain("title");
    expect(Object.keys(mine)).not.toContain("text");
    expect(Object.keys(mine)).not.toContain("dismissed");
    expect(await call<unknown[]>(B, "GET", "/dream-facts")).toEqual([]);
  });

  it("keeps the Dreamsign Awareness Scale rating (0-4) as a plain fact, and refuses 5", async () => {
    await call(A, "PUT", `/dreams/${dream.id}`, { awareness: 3 });
    const mine = (await call<Record<string, unknown>[]>(A, "GET", "/dream-facts")).find((f) => f.id === dream.id)!;
    expect(mine.awareness).toBe(3);
    await call(A, "PUT", `/dreams/${dream.id}`, { awareness: null });
    expect((await call<Record<string, unknown>>(A, "GET", `/dreams/${dream.id}`)).awareness).toBeNull();
    await expect(call(A, "PUT", `/dreams/${dream.id}`, { awareness: 5 })).rejects.toBeTruthy();
  });

  it("refuses values off the scales and unknown enum words", async () => {
    expect(await status(A, "POST", "/dreams", { nightId: night.id, lucidityLevel: 6 })).toBe(400);
    expect(await status(A, "POST", "/dreams", { nightId: night.id, control: 6 })).toBe(400);
    expect(await status(A, "POST", "/dreams", { nightId: night.id, wakeMethod: "parachute" })).toBe(400);
    expect(await status(A, "POST", "/nights", {})).toBe(400);
  });

  it("keeps one night per date, naps aside", async () => {
    expect(await status(A, "POST", "/nights", { date: "2026-11-05" })).toBe(409);
    const nap = await call<Night>(A, "POST", "/nights", { date: "2026-11-05", nap: true });
    expect(nap.nap).toBe(true);
    await call(A, "DELETE", `/nights/${nap.id}`);
    // a removed night frees its date
    const again = await call<Night>(A, "POST", "/nights", { date: "2026-11-05", nap: true });
    await call(A, "DELETE", `/nights/${again.id}`);
  });

  it("updates part of a row and keeps the rest", async () => {
    const d = await call<Dream>(A, "PUT", `/dreams/${dream.id}`, { control: 2, favourite: true });
    expect(d.control).toBe(2);
    expect(d.title).toBe("env:t");
    expect(d.lucidityLevel).toBe(3);
    expect(new Date(d.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(d.createdAt).getTime());
  });

  it("never takes user_id from the body", async () => {
    const d = await call<Dream>(A, "POST", "/dreams", { nightId: night.id, userId: B, user_id: B });
    const owner = (await eng.db.admin.query<{ user_id: string }>("SELECT user_id FROM dreams WHERE id = $1", [d.id])).rows[0]!.user_id;
    expect(owner).toBe(A);
  });

  it("logs reality checks, practice, the course, goals and reminders", async () => {
    const c = await call<RealityCheck>(A, "POST", "/reality-checks", { kind: "hands", outcome: "awake", prompted: true });
    expect((await call<RealityCheck[]>(A, "GET", "/reality-checks"))[0]!.id).toBe(c.id);
    await call(A, "POST", "/practice", { date: "2026-11-05", item: "mild", minutes: 10 });
    expect(await call<unknown[]>(A, "GET", "/practice", undefined, { from: "2026-11-01", to: "2026-11-30" })).toHaveLength(1);
    const l = await call<CourseProgress>(A, "PUT", "/course/lesson-1", { state: "done", doneAt: "2026-11-05T07:00:00Z" });
    expect((await call<CourseProgress>(A, "PUT", "/course/lesson-1", { answers: "env:q" })).id).toBe(l.id);
    expect(await call<unknown[]>(A, "GET", "/course")).toHaveLength(1);
    expect(l.startedAt).toBeNull();
    // a lesson's start is set when it becomes active and never moves after, whatever is written later
    const a = await call<CourseProgress>(A, "PUT", "/course/lesson-2", { state: "active", startedAt: "2026-11-01T08:00:00Z" });
    expect(new Date(a.startedAt!).toISOString()).toBe("2026-11-01T08:00:00.000Z");
    const later = await call<CourseProgress>(A, "PUT", "/course/lesson-2", { state: "active", startedAt: "2026-11-04T08:00:00Z", answers: "env:r" });
    expect(new Date(later.startedAt!).toISOString()).toBe("2026-11-01T08:00:00.000Z");
    expect((await call<CourseProgress>(A, "PUT", "/course/lesson-3", { state: "active" })).startedAt).not.toBeNull();
    const g = await call<Goal>(A, "POST", "/goals", { kind: "recall_per_week", target: 5 });
    expect(g.period).toBe("week");
    const rem = await call<Reminder>(A, "POST", "/reminders", { kind: "reality_check", schedule: { perDay: 6, note: "free text never stored" } });
    expect(rem.enabled).toBe(true);
    expect(rem.schedule).toEqual({ perDay: 6 });
    expect(await status(A, "POST", "/goals", { kind: "steps" })).toBe(400);
    // a missing kind is a plain 400, not a database error
    expect(await status(A, "POST", "/goals", { target: 3 })).toBe(400);
    expect(await status(A, "POST", "/reminders", {})).toBe(400);
  });

  it("answers 404 to a delete that finds nothing, and announces nothing", async () => {
    const topics = await announced(async () => {
      expect(await status(A, "DELETE", `/dreams/${dream.id}/elements/${uuidv7()}`)).toBe(404);
      expect(await status(A, "DELETE", "/course/no-such-lesson")).toBe(404);
      expect(await status(A, "DELETE", `/goals/${uuidv7()}`)).toBe(404);
    });
    expect(topics).toEqual([]);
    // the real link goes once, then it is gone
    const second = await call<Element>(A, "POST", "/elements", { kind: "place", name: "env:p" });
    await call(A, "POST", `/dreams/${dream.id}/elements`, { elementId: second.id });
    expect(await status(A, "DELETE", `/dreams/${dream.id}/elements/${second.id}`)).toBe(200);
    expect(await status(A, "DELETE", `/dreams/${dream.id}/elements/${second.id}`)).toBe(404);
    await call(A, "DELETE", `/elements/${second.id}`);
  });

  it("keeps one person's rows from another", async () => {
    expect(await status(B, "GET", `/nights/${night.id}`)).toBe(404);
    expect(await status(B, "GET", `/dreams/${dream.id}`)).toBe(404);
    expect(await status(B, "PUT", `/dreams/${dream.id}`, { lucid: false })).toBe(404);
    expect(await status(B, "DELETE", `/elements/${element.id}`)).toBe(404);
    expect(await status(B, "POST", "/dreams", { nightId: night.id })).toBe(400);
    expect(await status(B, "POST", `/dreams/${dream.id}/elements`, { elementId: element.id })).toBe(400);
    expect(await call(B, "GET", "/nights")).toEqual([]);
    expect(await call(B, "GET", "/dreams")).toEqual([]);
    expect(await call(B, "GET", "/elements")).toEqual([]);
    expect(await call(B, "GET", "/reality-checks")).toEqual([]);
    // the database itself refuses, even to a query that forgets WHERE user_id
    for (const t of ["nights", "dreams", "elements", "dream_elements", "reality_checks", "practice_log", "course_progress", "goals", "reminders"]) {
      const n = await withUser(eng.db, B, async (q) => (await q.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${t}`)).rows[0]!.n);
      expect(n, t).toBe(0);
      const mine = await withUser(eng.db, A, async (q) => (await q.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${t}`)).rows[0]!.n);
      expect(mine, t).toBeGreaterThan(0);
    }
    const stolen = await withUser(eng.db, B, async (q) => (await q.query("UPDATE dreams SET lucid = false WHERE id = $1 RETURNING id", [dream.id])).rows.length);
    expect(stolen).toBe(0);
  });

  it("refuses a row written in someone else's name (the policy's WITH CHECK)", async () => {
    // B, signed in, tries to insert rows that say they are A's; every user-owned table, media included
    const inserts: Record<string, [string, unknown[]]> = {
      nights: ["(id, user_id, date)", [uuidv7(), A, "2026-01-01"]],
      dreams: ["(id, user_id, night_id)", [uuidv7(), A, night.id]],
      elements: ["(id, user_id, kind)", [uuidv7(), A, "place"]],
      dream_elements: ["(id, user_id, dream_id, element_id)", [uuidv7(), A, dream.id, element.id]],
      media: ["(id, user_id, kind, mime, size)", [uuidv7(), A, "photo", "image/png", 1]],
      reality_checks: ["(id, user_id)", [uuidv7(), A]],
      practice_log: ["(id, user_id, date, item)", [uuidv7(), A, "2026-01-01", "mild"]],
      course_progress: ["(id, user_id, lesson_id)", [uuidv7(), A, "lesson-9"]],
      goals: ["(id, user_id, kind, target)", [uuidv7(), A, "recall_per_week", 1]],
      reminders: ["(id, user_id, kind)", [uuidv7(), A, "bedtime"]],
      day_notes: ["(id, user_id, date)", [uuidv7(), A, "2026-01-01"]],
    };
    for (const [t, [cols, vals]] of Object.entries(inserts)) {
      const ph = vals.map((_, i) => `$${i + 1}`).join(",");
      await expect(withUser(eng.db, B, (q) => q.query(`INSERT INTO ${t} ${cols} VALUES (${ph})`, vals)), t).rejects.toThrow(/row-level security/);
      const planted = (await eng.db.admin.query(`SELECT 1 FROM ${t} WHERE id = $1`, [vals[0]])).rows.length;
      expect(planted, t).toBe(0);
    }
  });

  it("exports the journal and restores it", async () => {
    const out = await call<Export>(A, "GET", "/export");
    expect(out.tables.dreams!).toHaveLength(2);
    expect(out.tables.dream_elements!).toHaveLength(2);
    expect(out.tables.dreams![0]!.user_id).toBeUndefined();
    const counts = await call<Record<string, number>>(A, "POST", "/import", { data: out, mode: "replace" });
    expect(counts.dreams).toBe(2);
    expect(await call<unknown[]>(A, "GET", "/dreams")).toHaveLength(2);
    expect((await call<DreamFull>(A, "GET", `/dreams/${dream.id}`)).elements).toHaveLength(1);
  });

  it("deletes by marking, and the marked rows stay out of sight", async () => {
    await call(A, "DELETE", `/dreams/${dream.id}`);
    expect(await status(A, "GET", `/dreams/${dream.id}`)).toBe(404);
    expect(await status(A, "PUT", `/dreams/${dream.id}`, { lucid: false })).toBe(404);
    expect(await status(A, "DELETE", `/dreams/${dream.id}`)).toBe(404);
    // a removed dream cannot be linked to or given media either
    expect(await status(A, "POST", `/dreams/${dream.id}/elements`, { elementId: element.id })).toBe(400);
    const row = (await eng.db.admin.query<{ deleted_at: string | null }>("SELECT deleted_at FROM dreams WHERE id = $1", [dream.id])).rows[0];
    expect(row!.deleted_at).not.toBeNull();
    expect((await call<ElementFull>(A, "GET", `/elements/${element.id}`)).dreams).toEqual([]);
    await call(A, "DELETE", `/nights/${night.id}`);
    expect(await call(A, "GET", "/dreams")).toEqual([]);
    expect(await call(A, "GET", "/nights")).toEqual([]);
  });

  it("brings a deleted dream back with the links it had, and not the ones removed before", async () => {
    const n = await call<Night>(A, "POST", "/nights", { date: "2024-03-01" });
    const d = await call<Dream>(A, "POST", "/dreams", { nightId: n.id, text: "to undo" });
    const e1 = await call<Element>(A, "POST", "/elements", { kind: "place", name: "kept" });
    const e2 = await call<Element>(A, "POST", "/elements", { kind: "place", name: "unlinked first" });
    await call(A, "POST", `/dreams/${d.id}/elements`, { elementId: e1.id });
    await call(A, "POST", `/dreams/${d.id}/elements`, { elementId: e2.id });
    await call(A, "DELETE", `/dreams/${d.id}/elements/${e2.id}`);
    await call(A, "DELETE", `/dreams/${d.id}`);
    expect(await status(A, "GET", `/dreams/${d.id}`)).toBe(404);
    const topics = await announced(() => call(A, "POST", `/dreams/${d.id}/restore`));
    expect(topics).toContain("dreams");
    expect((await call<DreamFull>(A, "GET", `/dreams/${d.id}`)).elements.map((l) => l.elementId)).toEqual([e1.id]);
    // again is fine; another person's or an unknown dream is not found
    expect(await status(A, "POST", `/dreams/${d.id}/restore`)).toBe(200);
    expect(await status(B, "POST", `/dreams/${d.id}/restore`)).toBe(404);
    expect(await status(A, "POST", `/dreams/${uuidv7()}/restore`)).toBe(404);
    // not into a night that is gone
    await call(A, "DELETE", `/dreams/${d.id}`);
    await call(A, "DELETE", `/nights/${n.id}`);
    expect(await status(A, "POST", `/dreams/${d.id}/restore`)).toBe(409);
  });

  it("takes a night's dreams, their links and their media along when the night goes", async () => {
    const n = await call<Night>(A, "POST", "/nights", { date: "2026-11-06" });
    const d = await call<Dream>(A, "POST", "/dreams", { nightId: n.id, title: "env:t2" });
    await call(A, "POST", `/dreams/${d.id}/elements`, { elementId: element.id });
    const mediaId = uuidv7();
    await withUser(eng.db, A, (q) => q.query("INSERT INTO media (id, user_id, kind, mime, size, path, dream_id) VALUES ($1,$2,'photo','image/png',1,'x',$3)", [mediaId, A, d.id]));
    const topics = await announced(() => call(A, "DELETE", `/nights/${n.id}`));
    expect(topics).toEqual(expect.arrayContaining(["nights", "dreams", "elements"]));
    const gone = async (t: string, where: string, v: string) =>
      (await eng.db.admin.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${t} WHERE ${where} = $1 AND deleted_at IS NOT NULL`, [v])).rows[0]!.n;
    expect(await gone("dreams", "id", d.id)).toBe(1);
    expect(await gone("dream_elements", "dream_id", d.id)).toBe(1);
    expect(await gone("media", "id", mediaId)).toBe(1);
    expect((await call<ElementFull>(A, "GET", `/elements/${element.id}`)).dreams).toEqual([]);
    expect(await status(A, "DELETE", `/nights/${n.id}`)).toBe(404);
  });
});
