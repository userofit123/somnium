// Everything in and out: the full backup/export (JSON) and restore (replace or merge).
// Merge (LDJ-35): rows missing here are added, and a row both sides have is taken from the file only when the file's
// copy is newer (updated_at), so the newest edit wins either way. A night the file has for a date that already has a
// night here under another id is matched to that night, and the file's dreams follow it, rather than being lost.
// New user tables join TABLES in the order they are restored (a table only points at tables above it).
// The rows go out as the database holds them: plaintext from a device (its replica, a local account), ciphertext
// from the server, which never opens a sealed column (PLAN.md §4.1). "sealed" says which, so a sealed export is
// not restored into a device's plaintext database.
import type { Router, Ctx } from "../router";
import type { Sql } from "../db";
import { bad } from "../errors";
import { oneOf } from "../util";
import { refusePlain } from "./rows";
import { previewImport } from "../sync/sealedApi";

export const EXPORT_FORMAT = 1;
const TABLES = ["nights", "dreams", "elements", "dream_elements", "media", "reality_checks", "practice_log", "course_progress", "goals", "reminders", "day_notes"] as const;

export async function exportAll(q: Sql, userId: string, sealed = false) {
  const tables: Record<string, any[]> = {};
  for (const t of TABLES) tables[t] = (await q.query(`SELECT * FROM ${t}`)).rows.map((r: any) => { const o = { ...r }; delete o.user_id; return o; });
  const settings = (await q.query("SELECT data FROM user_settings")).rows[0]?.data ?? {};
  const user = (await q.query("SELECT username, display_name, email FROM users WHERE id = $1", [userId])).rows[0];
  return { app: "somnium", format: EXPORT_FORMAT, exportedAt: new Date().toISOString(), sealed, user, settings, tables };
}

export async function importAll(ctx: Ctx, data: any, mode: "replace" | "merge") {
  if (!data || data.app !== "somnium" || !data.tables) throw bad("This is not a Somnium export");
  if (data.format > EXPORT_FORMAT) throw bad("This export is from a newer version of Somnium. Update the app first.");
  if (data.sealed && ctx.mode !== "server") throw bad("This export holds the journal sealed, as the server stores it. Export again from a signed-in device to restore it here.");
  // before the replace below removes anything, and outside the merge's savepoints, which would swallow it
  if (ctx.mode === "server") for (const t of TABLES) for (const row of Array.isArray(data.tables[t]) ? data.tables[t] : []) refusePlain(t, row);
  const q = ctx.q;
  if (mode === "replace") {
    // The one place that hard-deletes: a replace restore is the person's own, explicit choice to put their journal
    // back exactly as the export has it, so the rows it replaces are not kept as "removed" (they would sync back as
    // deletions and double the data). Only their own rows go: row-level security (the app role, 002/004) limits the
    // DELETE to user_id = the signed-in person, and the WHERE says so again.
    for (const t of [...TABLES].reverse()) await q.query(`DELETE FROM ${t} WHERE user_id = $1`, [ctx.userId]);
    if (data.settings) await q.query("INSERT INTO user_settings (user_id, data) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET data = $2", [ctx.userId, JSON.stringify(data.settings)]);
  }
  const counts: Record<string, number> = {};
  const jsonCols = new Map<string, Set<string>>();
  // the file's night id -> the id of the night this account already has for that date (merge only)
  const nightOf = new Map<string, string>();
  for (const t of TABLES) {
    const rows: any[] = Array.isArray(data.tables[t]) ? data.tables[t] : [];
    let n = 0;
    for (const raw of rows) {
      const row: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(raw ?? {})) if (/^[a-z_0-9]+$/.test(k)) row[k] = v;
      row.user_id = ctx.userId;
      if (mode === "merge" && t === "nights" && row.date && !row.nap && !row.deleted_at) {
        const same = (await q.query("SELECT id FROM nights WHERE date = $1 AND NOT nap AND deleted_at IS NULL AND id <> $2", [row.date, row.id])).rows[0];
        if (same) { nightOf.set(String(row.id), same.id); continue; }
      }
      if (t === "dreams" && typeof row.night_id === "string" && nightOf.has(row.night_id)) row.night_id = nightOf.get(row.night_id);
      const cols = Object.keys(row);
      // json columns get JSON (an empty list included); text[] columns get the list as it is
      const json = jsonCols.get(t) ?? new Set((await ctx.q.query("SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND data_type IN ('json', 'jsonb')", [t])).rows.map((x: any) => x.column_name));
      jsonCols.set(t, json);
      const vals = cols.map((c) => { const v = row[c]; return v != null && json.has(c) ? JSON.stringify(v) : v; });
      const insert = `INSERT INTO ${t} (${cols.join(",")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(",")})`;
      // merge: the newer copy of a row both sides have wins (a file without updated_at never overwrites)
      const sets = cols.filter((c) => c !== "id" && c !== "user_id").map((c) => `${c} = EXCLUDED.${c}`);
      const sql = mode === "merge" && cols.includes("updated_at") && sets.length
        ? `${insert} ON CONFLICT (id) DO UPDATE SET ${sets.join(", ")} WHERE ${t}.updated_at < EXCLUDED.updated_at RETURNING 1`
        : `${insert} ON CONFLICT DO NOTHING RETURNING 1`;
      if (mode === "merge") {
        // a row that no longer fits (e.g. points at something missing) is left out of a merge
        await q.query("SAVEPOINT r");
        try { n += (await q.query(sql, vals)).rows.length; await q.query("RELEASE SAVEPOINT r"); }
        catch { await q.query("ROLLBACK TO SAVEPOINT r"); }
      } else n += (await q.query(sql, vals)).rows.length;
    }
    counts[t] = n;
  }
  ctx.changed("everything");
  return counts;
}

export function dataRoutes(r: Router) {
  r.get("/export", async (ctx) => exportAll(ctx.q, ctx.userId, ctx.mode === "server"));
  r.post("/import", async (ctx, _p, b) => importAll(ctx, b.data, oneOf(b.mode, ["replace", "merge"], "merge")));
  r.post("/import/preview", async (_ctx, _p, b) => {
    const pv = previewImport(b);
    if (!pv) throw bad("This is not a Somnium export");
    return pv;
  });
}
