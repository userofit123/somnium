// Reading and writing synced rows, the same way on the server and on a device.
// Rows travel as JSON made by to_jsonb and are written back with jsonb_populate_record, so every column type round-trips.
import type { Sql } from "../db";
import { SYNCED, SYNCED_BY_NAME } from "./tables";

export interface Change { tbl: string; pk: Record<string, unknown>; op: "upsert" | "delete"; at: string; row?: Record<string, unknown> | null }

/** One key per row: the table and its key columns, in the table's own order. */
export const keyOf = (tbl: string, pk: Record<string, unknown>) => tbl + ":" + JSON.stringify((SYNCED_BY_NAME.get(tbl)?.pk ?? Object.keys(pk)).map((c) => pk[c]));

const cols = new Map<string, string[]>();
async function columns(q: Sql, t: string) {
  if (!cols.has(t)) cols.set(t, (await q.query<{ c: string }>(
    "SELECT column_name AS c FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position", [t])).rows.map((x) => x.c));
  return cols.get(t)!;
}

/** The rows as they are now, for a list of keys (missing = deleted). */
export async function readRows(q: Sql, keys: { tbl: string; pk: Record<string, unknown> }[]): Promise<Map<string, Record<string, unknown> | null>> {
  const out = new Map<string, Record<string, unknown> | null>();
  const byTable = new Map<string, { tbl: string; pk: Record<string, unknown> }[]>();
  for (const k of keys) { out.set(keyOf(k.tbl, k.pk), null); byTable.set(k.tbl, [...(byTable.get(k.tbl) ?? []), k]); }
  for (const [t, list] of byTable) {
    const def = SYNCED_BY_NAME.get(t);
    if (!def) continue;
    if (def.pk.length === 1 && def.pk[0] === "id") {
      for (const r of (await q.query(`SELECT to_jsonb(x) AS r FROM ${t} x WHERE x.id = ANY($1::uuid[])`, [list.map((k) => k.pk.id)])).rows)
        out.set(keyOf(t, { id: r.r.id }), r.r);
    } else {
      for (const k of list) {
        const r = (await q.query(`SELECT to_jsonb(x) AS r FROM ${t} x WHERE to_jsonb(x) @> $1::jsonb`, [JSON.stringify(k.pk)])).rows[0];
        if (r) out.set(keyOf(t, k.pk), r.r);
      }
    }
  }
  return out;
}

/** Every synced row of the person (the first copy a device gets). */
export async function allRows(q: Sql): Promise<Record<string, Record<string, unknown>[]>> {
  const tables: Record<string, Record<string, unknown>[]> = {};
  for (const t of SYNCED) tables[t.name] = (await q.query(`SELECT to_jsonb(x) AS r FROM ${t.name} x`)).rows.map((x: any) => x.r);
  return tables;
}

/**
 * Tables where a deletion is final: a later change to the same row made somewhere that hadn't heard yet must not
 * bring it back (their ids are made fresh every time, so a deleted one never legitimately comes back).
 * Empty for now; a table whose rows are removed for good (not archived) joins the set.
 */
export const DELETES_WIN = new Set<string>([]);

/**
 * Rules that decide before "the newest change wins" (whose clocks can disagree between a phone and a server).
 * true: the incoming change wins; false: what's here stays; null: newest wins. here: the row as it is now
 * (null: none), and the last thing logged for it here.
 */
export function overrule(c: Change, here: { row: Record<string, unknown> | null; lastOp?: string | null }): boolean | null {
  if (DELETES_WIN.has(c.tbl)) {
    if (c.op === "delete") return true;
    if (!here.row && here.lastOp === "delete") return false;
  }
  return null;
}

/**
 * Tables with one live row per natural key, whose rows two devices can make separately while offline. Nothing points
 * at these rows, so the loser can simply be marked removed. (nights also has a unique index, but dreams hang off a
 * night: two nights can't be settled without moving those dreams, so they are not here.)
 */
export const NATURAL_KEYS: Readonly<Record<string, readonly string[]>> = {
  course_progress: ["user_id", "lesson_id"],
  dream_elements: ["dream_id", "element_id"],
};

/**
 * Two live rows for one natural key: the newest row stays live and the other is marked removed. The rows decide (their
 * updated_at, then their id), not the order they arrive in, so the server and every device reach the same answer.
 * Each row keeps its own id: a sealed value is bound to its row's id, so it is never moved to the other row, and
 * no device has to seal anything again. Answers the row to write, and whether that row lost.
 */
async function settleDuplicate(q: Sql, c: Change, row: Record<string, unknown>): Promise<{ row: Record<string, unknown>; lost: boolean }> {
  const natural = NATURAL_KEYS[c.tbl];
  if (!natural || row.deleted_at != null) return { row, lost: false };
  const where = natural.map((k, i) => `${k} = $${i + 2}`).join(" AND ");
  const other = (await q.query(`SELECT id, to_jsonb(x)->>'updated_at' AS at FROM ${c.tbl} x WHERE id <> $1 AND deleted_at IS NULL AND ${where}`, [row.id, ...natural.map((k) => row[k])])).rows[0];
  if (!other) return { row, lost: false };
  const mine = String(row.updated_at ?? c.at);
  const mineAt = Date.parse(mine), otherAt = Date.parse(other.at);
  const wins = mineAt !== otherAt ? mineAt > otherAt : String(row.id) > String(other.id);
  if (wins) { await q.query(`UPDATE ${c.tbl} SET deleted_at = $2 WHERE id = $1`, [other.id, mine]); return { row, lost: false }; }
  return { row: { ...row, deleted_at: other.at }, lost: true };
}

/**
 * Writes changes made elsewhere: upserts parents first, then deletes children first.
 * Each row on its own savepoint, so one that no longer fits (its parent was deleted meanwhile) doesn't stop the rest.
 * origin: who made them (the server logs it, so that device isn't sent its own changes back); apply: a device writing
 * the server's rows (not logged at all).
 */
export async function applyChanges(q: Sql, userId: string, changes: Change[], opts: { origin?: string; apply?: boolean } = {}) {
  const ord = (c: Change) => SYNCED_BY_NAME.get(c.tbl)!.order;
  const list = [
    ...changes.filter((c) => c.op === "upsert" && c.row).sort((a, b) => ord(a) - ord(b)),
    ...changes.filter((c) => c.op === "delete").sort((a, b) => ord(b) - ord(a)),
  ];
  if (opts.apply) await q.query("SELECT set_config('somnium.sync_apply', '1', true)");
  const failed: { change: Change; error: string }[] = [];
  // upserts sent to the server that lost to another row (settleDuplicate): the device that sent them gets them back,
  // because the log won't send a device its own changes
  const kept: Change[] = [];
  for (const c of list) {
    const def = SYNCED_BY_NAME.get(c.tbl)!;
    await q.query("SAVEPOINT somnium_row");
    try {
      if (opts.origin != null) await q.query("SELECT set_config('somnium.sync_origin', $1, true), set_config('somnium.sync_at', $2, true)", [opts.origin, c.at]);
      if (c.op === "upsert") {
        const all = await columns(q, c.tbl);
        // a row always belongs to whoever is writing it, whatever the JSON says
        const { row, lost } = await settleDuplicate(q, c, { ...c.row, ...(all.includes("user_id") ? { user_id: userId } : {}) });
        // only the columns the JSON has: a device on an older app doesn't know newer columns, so a new row takes their
        // default and an existing row keeps its value, instead of both becoming NULL
        const has = all.filter((x) => x in row);
        const rest = has.filter((x) => !def.pk.includes(x));
        await q.query(
          `INSERT INTO ${c.tbl} (${has.join(", ")}) SELECT ${has.join(", ")} FROM jsonb_populate_record(NULL::${c.tbl}, $1::jsonb)
           ON CONFLICT (${def.pk.join(", ")}) DO ${rest.length ? `UPDATE SET ${rest.map((x) => `${x} = EXCLUDED.${x}`).join(", ")}` : "NOTHING"}`, [JSON.stringify(row)]);
        if (lost && !opts.apply) kept.push(c);
      } else if (def.pk.length === 1 && def.pk[0] === "id") {
        await q.query(`DELETE FROM ${c.tbl} WHERE id = $1`, [c.pk.id]);
      } else {
        await q.query(`DELETE FROM ${c.tbl} x WHERE to_jsonb(x) @> $1::jsonb`, [JSON.stringify(c.pk)]);
      }
      await q.query("RELEASE SAVEPOINT somnium_row");
    } catch (e) {
      await q.query("ROLLBACK TO SAVEPOINT somnium_row");
      failed.push({ change: c, error: (e as Error).message });
    }
  }
  if (opts.apply) await q.query("SELECT set_config('somnium.sync_apply', '', true)");
  return { applied: list.length - failed.length - kept.length, failed, kept };
}

/** The latest change per row among log entries (oldest first, as they come from the log). */
export function latestPerRow<T extends { tbl: string; pk: Record<string, unknown> }>(entries: T[]): T[] {
  const m = new Map<string, T>();
  for (const e of entries) { const k = keyOf(e.tbl, e.pk); m.delete(k); m.set(k, e); }
  return [...m.values()];
}
