// The engine end to end on PGlite: settings, the profile, export/import, and above all that one person can never
// see or change another's data.
import { describe, it, expect, beforeAll } from "vitest";
import { createEngine, type Engine } from "../src/index";
import { pgliteDb } from "../src/adapters/pglite";
import { uuidv7 } from "../src/ids";

let eng: Engine;
let A: string, B: string;
const call = async (user: string, method: string, path: string, body?: unknown, query?: Record<string, string>) => {
  const r = await eng.handle({ method, path, body, query, userId: user });
  if (r.status !== 200) throw Object.assign(new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`), { status: r.status });
  return r.body as any;
};

beforeAll(async () => {
  eng = await createEngine(await pgliteDb("memory://"), { mode: "server" });
  A = uuidv7(); B = uuidv7();
  await eng.db.admin.query("INSERT INTO users (id, username, display_name) VALUES ($1,'a','A'), ($2,'b','B')", [A, B]);
}, 120000);

describe("engine", () => {
  it("answers /me with defaults and keeps a partial settings update", async () => {
    const me = await call(A, "GET", "/me");
    expect(me.user.username).toBe("a");
    expect(me.settings.clock).toBe("24");
    const next = await call(A, "PUT", "/settings", { firstDay: 0 });
    expect(next.firstDay).toBe(0);
    expect((await call(A, "GET", "/me")).settings.firstDay).toBe(0);
    expect((await call(B, "GET", "/me")).settings.firstDay).not.toBe(0);
  });

  it("announces what changed", async () => {
    const seen: string[][] = [];
    const off = eng.onChange((_u, topics) => seen.push(topics));
    await call(A, "PUT", "/me", { displayName: "Ann" });
    off();
    expect(seen.flat()).toContain("settings");
  });

  it("keeps one person's rows from another", async () => {
    await eng.db.admin.query("SELECT 1");
    const mine = (await eng.handle({ method: "GET", path: "/activity-log", userId: A })).body as any;
    expect(mine.entries.length).toBeGreaterThan(0);
    const theirs = (await eng.handle({ method: "GET", path: "/activity-log", userId: B })).body as any;
    expect(theirs.entries.length).toBe(0);
  });

  it("exports and restores", async () => {
    const out = await call(A, "GET", "/export");
    expect(out.app).toBe("somnium");
    expect(out.settings.firstDay).toBe(0);
    await call(B, "POST", "/import", { data: out, mode: "replace" });
    expect((await call(B, "GET", "/me")).settings.firstDay).toBe(0);
    const p = await call(B, "POST", "/import/preview", { data: out });
    expect(p.format).toBe(1);
  });

  it("refuses what is not an export", async () => {
    const r = await eng.handle({ method: "POST", path: "/import", body: { data: { app: "other" } }, userId: A });
    expect(r.status).toBe(400);
  });

  it("creates the single person of a local account once", async () => {
    const local = await createEngine(await pgliteDb("memory://"), { mode: "local" });
    const id = await local.ensureLocalUser("Me");
    expect(await local.ensureLocalUser()).toBe(id);
  });
});
