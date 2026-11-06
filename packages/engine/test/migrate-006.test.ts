// 006: installs that ran 004 before it had the one-night-per-date rule get the rule, and nights they already have
// twice for one date are settled first, keeping every dream.
import { describe, it, expect, beforeAll } from "vitest";
import { createEngine, type Engine } from "../src/index";
import { pgliteDb } from "../src/adapters/pglite";
import { migrate } from "../src/migrate";
import { uuidv7 } from "../src/ids";

let eng: Engine;
let U: string, V: string;
const q = <T = any>(sql: string, args: unknown[] = []) => eng.db.admin.query<T>(sql, args).then((r) => r.rows);

beforeAll(async () => {
  eng = await createEngine(await pgliteDb("memory://"), { mode: "local" });
  U = uuidv7(); V = uuidv7();
  await q("INSERT INTO users (id, username, display_name) VALUES ($1,'u','U'), ($2,'v','V')", [U, V]);
}, 120000);

describe("006_one_night", () => {
  it("moves the dreams to the newest night of a date, marks the others deleted and adds the rule", async () => {
    // an install as the old 004 left it: no rule, and two (here three) live nights for one date
    await q("DROP INDEX nights_user_date_live");
    await q("DELETE FROM schema_migrations WHERE name = '006_one_night'");
    const [n1, n2, n3, nap, other, theirs] = [uuidv7(), uuidv7(), uuidv7(), uuidv7(), uuidv7(), uuidv7()];
    const night = (id: string, user: string, date: string, isNap: boolean, at: string) =>
      q("INSERT INTO nights (id, user_id, date, nap, created_at) VALUES ($1,$2,$3,$4,$5)", [id, user, date, isNap, at]);
    await night(n1, U, "2026-10-01", false, "2026-10-01T07:00:00Z");
    await night(n3, U, "2026-10-01", false, "2026-10-01T09:00:00Z");
    await night(n2, U, "2026-10-01", false, "2026-10-01T08:00:00Z");
    await night(nap, U, "2026-10-01", true, "2026-10-01T15:00:00Z");
    await night(other, U, "2026-10-02", false, "2026-10-02T07:00:00Z");
    await night(theirs, V, "2026-10-01", false, "2026-10-01T06:00:00Z");
    const dream = async (nightId: string, user = U) => { const id = uuidv7(); await q("INSERT INTO dreams (id, user_id, night_id) VALUES ($1,$2,$3)", [id, user, nightId]); return id; };
    const d1 = await dream(n1), d2 = await dream(n2), d3 = await dream(n3), dn = await dream(nap), dv = await dream(theirs, V);

    expect(await migrate(eng.db)).toEqual(["006_one_night"]);

    const nights = await q<{ id: string; deleted: boolean }>("SELECT id, deleted_at IS NOT NULL AS deleted FROM nights WHERE id = ANY($1)", [[n1, n2, n3, nap, other, theirs]]);
    const gone = new Set(nights.filter((n) => n.deleted).map((n) => n.id));
    expect(gone).toEqual(new Set([n1, n2])); // the newest (n3) stays; the nap, the other date and the other person aren't touched
    const where = new Map((await q<{ id: string; night_id: string }>("SELECT id, night_id FROM dreams WHERE id = ANY($1)", [[d1, d2, d3, dn, dv]])).map((r) => [r.id, r.night_id]));
    expect([where.get(d1), where.get(d2), where.get(d3)]).toEqual([n3, n3, n3]);
    expect(where.get(dn)).toBe(nap);
    expect(where.get(dv)).toBe(theirs);
    // the changes are logged, so every device hears of them
    expect((await q("SELECT 1 FROM sync_log WHERE tbl = 'nights' AND pk->>'id' = $1", [n1])).length).toBeGreaterThan(0);

    // the rule holds from now on, and a nap still doesn't count
    await expect(night(uuidv7(), U, "2026-10-01", false, "2026-10-03T07:00:00Z")).rejects.toThrow();
    await night(uuidv7(), U, "2026-10-01", true, "2026-10-03T07:00:00Z");
  });

  it("changes nothing where 004 already made the rule", async () => {
    await q("DELETE FROM schema_migrations WHERE name = '006_one_night'");
    const before = await q("SELECT id, night_id, updated_at FROM dreams ORDER BY id");
    expect(await migrate(eng.db)).toEqual(["006_one_night"]);
    expect(await q("SELECT id, night_id, updated_at FROM dreams ORDER BY id")).toEqual(before);
  });
});
