// Isolation (PLAN.md §4.5): person B can never reach person A's rows. Asked two ways: through every route the engine
// registers (read from its modules, so a new route is asked too), and through raw SQL under the app role, which
// is what row-level security is for. A forgotten WHERE user_id in a handler must still show nothing.
import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createEngine, withUser, type Engine } from "../src/index";
import { pgliteDb } from "../src/adapters/pglite";
import { uuidv7 } from "../src/ids";

const SECRET = "ISOLATION-SECRET-91c4";
let eng: Engine, A: string, B: string;
const ids: Record<string, string> = {};
const as = (u: string, method: string, p: string, body?: unknown) => eng.handle({ method, path: p, body, userId: u });

const ROUTES = fs.readdirSync(path.join(__dirname, "../src/modules")).filter((f) => f.endsWith(".ts")).flatMap((f) =>
  [...fs.readFileSync(path.join(__dirname, "../src/modules", f), "utf8").matchAll(/\br\.(get|post|put|del)\("([^"]+)"/g)]
    .map((m) => ({ method: m[1] === "del" ? "DELETE" : m[1]!.toUpperCase(), route: m[2]! })));
const fill = (route: string) => route.replace(/\/([^/:]+)\/:[a-zA-Z]+/g, (_, seg: string) => `/${seg}/${ids[seg] ?? uuidv7()}`).replace(/:[a-zA-Z]+/g, () => uuidv7());

beforeAll(async () => {
  eng = await createEngine(await pgliteDb("memory://"), { mode: "local" });
  A = uuidv7(); B = uuidv7();
  await eng.db.admin.query("INSERT INTO users (id, username, display_name) VALUES ($1,'a','A'), ($2,'b','B')", [A, B]);
  const ok = async (m: string, p: string, b: unknown) => { const r = await as(A, m, p, b); expect(r.status, `${m} ${p}`).toBe(200); return r.body as any; };
  const night = await ok("POST", "/nights", { date: "2026-11-05", notes: SECRET });
  const dream = await ok("POST", "/dreams", { nightId: night.id, title: SECRET, text: SECRET, lucid: true });
  const el = await ok("POST", "/elements", { kind: "character", name: SECRET, isDreamSign: true });
  await ok("POST", `/dreams/${dream.id}/elements`, { elementId: el.id, span: SECRET });
  const check = await ok("POST", "/reality-checks", { kind: "hands", note: SECRET });
  const practice = await ok("POST", "/practice", { date: "2026-11-05", item: "wbtb", note: SECRET });
  await ok("PUT", "/course/lesson-1", { state: "done", answers: SECRET });
  await ok("PUT", "/me", { displayName: SECRET });
  Object.assign(ids, { nights: night.id, dreams: dream.id, elements: el.id, "reality-checks": check.id, practice: practice.id, course: "lesson-1" });
}, 120000);

describe("isolation through the routes", () => {
  it("finds the engine's routes", () => {
    expect(ROUTES.length).toBeGreaterThan(30);
  });

  it("every route answers B nothing of A's rows", async () => {
    for (const { method, route } of ROUTES) {
      const r = await as(B, method, fill(route), method === "GET" || method === "DELETE" ? undefined : {});
      expect(JSON.stringify(r.body) ?? "", `${method} ${route}`).not.toContain(SECRET);
    }
  });

  it("B's lists hold nothing of A and A's row ids are not found", async () => {
    for (const p of ["/dreams", "/nights", "/elements", "/reality-checks", "/practice"]) {
      const list = (await as(B, "GET", p)).body as any;
      const rows = Array.isArray(list) ? list : Object.values(list).find(Array.isArray) ?? [];
      // a person's own starter elements may exist; what matters is that none is A's
      expect(JSON.stringify(rows), p).not.toContain(SECRET);
      expect(JSON.stringify(rows), p).not.toContain(ids[p.slice(1)] ?? "no-such-id");
    }
    for (const p of [`/dreams/${ids.dreams}`, `/nights/${ids.nights}`]) expect((await as(B, "GET", p)).status, p).toBe(404);
  });

  it("B can't change or delete A's rows, and A's survive", async () => {
    await as(B, "PUT", `/dreams/${ids.dreams}`, { title: "hijacked" });
    await as(B, "DELETE", `/dreams/${ids.dreams}`);
    await as(B, "DELETE", `/nights/${ids.nights}`);
    const mine = (await as(A, "GET", `/dreams/${ids.dreams}`)).body as any;
    expect(mine.title).toBe(SECRET);
    expect(mine.deletedAt ?? null).toBeNull();
  });

  it("an export and the activity log of B hold nothing of A", async () => {
    for (const p of ["/export", "/activity-log", "/me"]) expect(JSON.stringify((await as(B, "GET", p)).body), p).not.toContain(SECRET);
  });
});

describe("isolation through raw SQL (row-level security)", () => {
  it("every table with a user_id column has RLS on and a policy", async () => {
    const t = await eng.db.admin.query<{ relname: string; relrowsecurity: boolean }>(
      `SELECT c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
          AND EXISTS (SELECT 1 FROM information_schema.columns k WHERE k.table_schema='public' AND k.table_name=c.relname AND k.column_name='user_id')`);
    expect(t.rows.length).toBeGreaterThan(5);
    for (const row of t.rows) {
      // the sign-in tables are not granted to the app role at all; everything else must be protected
      const granted = await eng.db.admin.query("SELECT has_table_privilege('somnium_app', $1, 'SELECT') AS g", [row.relname]);
      if ((granted.rows[0] as any).g) {
        expect(row.relrowsecurity, `${row.relname} has RLS`).toBe(true);
        const pol = await eng.db.admin.query("SELECT 1 FROM pg_policies WHERE tablename = $1", [row.relname]);
        expect(pol.rows.length, `${row.relname} has a policy`).toBeGreaterThan(0);
      }
    }
  });

  it("a bare SELECT * as B returns none of A's rows, on every table the app role can read", async () => {
    const tables = (await eng.db.admin.query<{ table_name: string }>(
      `SELECT DISTINCT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='user_id'`)).rows.map((r) => r.table_name);
    let withRows = 0;
    for (const t of tables) {
      const granted = (await eng.db.admin.query("SELECT has_table_privilege('somnium_app', $1, 'SELECT') AS g", [t])).rows[0] as any;
      if (!granted.g) continue;
      const a = await withUser(eng.db, A, (q) => q.query(`SELECT count(*)::int AS n FROM "${t}"`));
      const b = await withUser(eng.db, B, (q) => q.query(`SELECT count(*)::int AS n FROM "${t}" WHERE user_id IS DISTINCT FROM $1`, [B]));
      if ((a.rows[0] as any).n > 0) withRows++;
      expect((b.rows[0] as any).n, `${t} shows B another person's rows`).toBe(0);
    }
    expect(withRows).toBeGreaterThan(3);
  });

  it("B can't update, delete or insert as A", async () => {
    const upd = await withUser(eng.db, B, (q) => q.query("UPDATE dreams SET title = 'x' RETURNING id"));
    expect(upd.rows.length).toBe(0);
    const del = await withUser(eng.db, B, (q) => q.query("DELETE FROM dreams RETURNING id"));
    expect(del.rows.length).toBe(0);
    await expect(withUser(eng.db, B, (q) => q.query("INSERT INTO nights (id, user_id, date) VALUES ($1,$2,'2026-01-01')", [uuidv7(), A]))).rejects.toThrow();
    const left = await eng.db.admin.query("SELECT count(*)::int AS n FROM dreams WHERE user_id = $1 AND deleted_at IS NULL", [A]);
    expect((left.rows[0] as any).n).toBe(1);
  });

  it("with no person set, the app role sees nothing", async () => {
    const r = await eng.db.tx(async (q) => { await q.query("SET LOCAL ROLE somnium_app"); return q.query("SELECT count(*)::int AS n FROM dreams"); });
    expect((r.rows[0] as any).n).toBe(0);
  });

  it("the sign-in tables are closed to the app role", async () => {
    for (const t of ["sessions", "invites", "app_meta", "sign_in_tries"]) {
      await expect(withUser(eng.db, A, (q) => q.query(`SELECT * FROM ${t}`)), t).rejects.toThrow();
    }
  });
});
