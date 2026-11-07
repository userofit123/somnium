// 017: one live day note per date. Notes already there twice for one date are settled first: the newest stays, the
// others are removed with merged_into pointing at it (their own text stays under their own id, for a device to join).
import { describe, it, expect } from "vitest";
import { createEngine } from "../src/index";
import { pgliteDb } from "../src/adapters/pglite";
import { migrate } from "../src/migrate";
import { uuidv7 } from "../src/ids";

describe("017_day_note_per_date", () => {
  it("keeps the newest note of a date live, points the others at it and adds the rule", async () => {
    const eng = await createEngine(await pgliteDb("memory://"), { mode: "local" });
    const q = <T = any>(sql: string, args: unknown[] = []) => eng.db.admin.query<T>(sql, args).then((r) => r.rows);
    const [U, V] = [uuidv7(), uuidv7()];
    await q("INSERT INTO users (id, username, display_name) VALUES ($1,'u','U'), ($2,'v','V')", [U, V]);
    // an install as 015 left it: no rule
    await q("DROP INDEX day_notes_user_date_live");
    await q("DELETE FROM schema_migrations WHERE name = '017_day_note_per_date'");
    const [a, b, c, other, theirs] = [uuidv7(), uuidv7(), uuidv7(), uuidv7(), uuidv7()];
    const note = (id: string, user: string, date: string, at: string) => q("INSERT INTO day_notes (id, user_id, date, text, updated_at) VALUES ($1,$2,$3,'t',$4)", [id, user, date, at]);
    await note(a, U, "2026-10-01", "2026-10-01T07:00:00Z");
    await note(b, U, "2026-10-01", "2026-10-01T09:00:00Z");
    await note(c, U, "2026-10-01", "2026-10-01T08:00:00Z");
    await note(other, U, "2026-10-02", "2026-10-02T07:00:00Z");
    await note(theirs, V, "2026-10-01", "2026-10-01T06:00:00Z");

    expect(await migrate(eng.db)).toEqual(["017_day_note_per_date"]);

    const rows = new Map((await q<{ id: string; gone: boolean; merged_into: string | null; text: string }>("SELECT id, deleted_at IS NOT NULL AS gone, merged_into, text FROM day_notes")).map((r) => [r.id, r]));
    expect([a, c].map((x) => rows.get(x))).toEqual([{ id: a, gone: true, merged_into: b, text: "t" }, { id: c, gone: true, merged_into: b, text: "t" }]);
    for (const x of [b, other, theirs]) expect(rows.get(x)).toMatchObject({ gone: false, merged_into: null });
    await expect(note(uuidv7(), U, "2026-10-01", "2026-10-03T07:00:00Z")).rejects.toThrow();
    await note(uuidv7(), U, "2026-10-03", "2026-10-03T07:00:00Z");
    await eng.db.close();
  }, 120000);
});
