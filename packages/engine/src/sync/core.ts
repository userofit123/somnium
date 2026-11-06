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
 * at these rows, so the loser can simply be marked removed. (nights also has one live row per date, but dreams hang off
 * a night, so two nights are merged instead: settleNight below.)
 */
export const NATURAL_KEYS: Readonly<Record<string, readonly string[]>> = {
  course_progress: ["user_id", "lesson_id"],
  dream_elements: ["dream_id", "element_id"],
};

const time = (v: unknown) => { const t = Date.parse(String(v ?? "")); return Number.isNaN(t) ? 0 : t; };

/**
 * Two live rows for one natural key: the newest row stays live and the other is marked removed. The rows decide (their
 * updated_at, then their id), not the order they arrive in, so the server and every device reach the same answer.
 * Each row keeps its own id: a sealed value is bound to its row's id, so it is never moved to the other row, and
 * no device has to seal anything again. Answers the row to write, and whether that row lost.
 * A deletion takes part too (LDJ-52): a row deleted more recently than a live duplicate was last changed removes that
 * duplicate as well (the person removed the lesson or link after the other device last touched it), and a live row
 * that arrives older than such a deletion is removed on arrival. Strictly newer only: a row that lost here gets the
 * winner's updated_at as its deleted_at, so a loser never takes its winner down with it.
 * aside(): what the rule does to other rows is logged for every device, the one that sent this row included.
 */
async function settleDuplicate(q: Sql, c: Change, row: Record<string, unknown>, aside: () => Promise<void>): Promise<{ row: Record<string, unknown>; lost: boolean }> {
  const natural = NATURAL_KEYS[c.tbl];
  if (!natural) return { row, lost: false };
  const where = natural.map((k, i) => `${k} = $${i + 2}`).join(" AND ");
  const args = [row.id, ...natural.map((k) => row[k])];
  if (row.deleted_at != null) {
    const gone = time(row.deleted_at);
    const older = (await q.query(`SELECT id, to_jsonb(x)->>'updated_at' AS at FROM ${c.tbl} x WHERE id <> $1 AND deleted_at IS NULL AND ${where}`, args)).rows
      .filter((o: any) => time(o.at) < gone);
    if (older.length) await aside();
    for (const o of older) await q.query(`UPDATE ${c.tbl} SET deleted_at = $2 WHERE id = $1`, [o.id, row.deleted_at]);
    return { row, lost: false };
  }
  const mine = String(row.updated_at ?? c.at), mineAt = time(mine);
  const removed = (await q.query(`SELECT max(deleted_at) AS at FROM ${c.tbl} WHERE id <> $1 AND deleted_at IS NOT NULL AND ${where}`, args)).rows[0]?.at;
  if (removed != null && time(removed instanceof Date ? removed.toISOString() : removed) > mineAt) return { row: { ...row, deleted_at: removed }, lost: true };
  const other = (await q.query(`SELECT id, to_jsonb(x)->>'updated_at' AS at FROM ${c.tbl} x WHERE id <> $1 AND deleted_at IS NULL AND ${where}`, args)).rows[0];
  if (!other) return { row, lost: false };
  const otherAt = time(other.at);
  const wins = mineAt !== otherAt ? mineAt > otherAt : String(row.id) > String(other.id);
  if (wins) { await q.query(`UPDATE ${c.tbl} SET deleted_at = $2 WHERE id = $1`, [other.id, mine]); return { row, lost: false }; }
  return { row: { ...row, deleted_at: other.at }, lost: true };
}

/**
 * Two live nights for one date (LDJ-52; the unique index nights_user_date_live). They are merged, not refused: the
 * night made first survives (created_at, then the lower id), a rule every device and the server compute alike from
 * the rows alone, whichever arrives first. The other is soft-deleted under its own id with merged_into pointing at
 * the survivor (its updated_at stays, so its fields can still be weighed against the survivor's). Its dreams are
 * moved over afterwards (settleMerged). Naps are never merged. aside(): as in settleDuplicate. Answers the row to write and whether a merge happened.
 */
async function settleNight(q: Sql, c: Change, row: Record<string, unknown>, aside: () => Promise<void>): Promise<{ row: Record<string, unknown>; merged: string | null }> {
  if (row.deleted_at != null || row.nap === true || row.date == null) return { row, merged: null };
  const other = (await q.query(`SELECT to_jsonb(x) AS r FROM nights x WHERE id <> $1 AND user_id = $2 AND date = $3::date AND deleted_at IS NULL AND NOT nap`,
    [row.id, row.user_id, row.date])).rows[0]?.r as Record<string, unknown> | undefined;
  if (!other) return { row, merged: null };
  const mineAt = time(row.created_at ?? c.at), otherAt = time(other.created_at);
  const mineFirst = mineAt !== otherAt ? mineAt < otherAt : String(row.id) < String(other.id);
  const gone = new Date(Math.max(time(row.updated_at ?? c.at), time(other.updated_at))).toISOString();
  await aside();
  if (mineFirst) {
    await q.query("UPDATE nights SET deleted_at = $2, merged_into = $3 WHERE id = $1", [other.id, gone, row.id]);
    return { row, merged: String(other.id) };
  }
  return { row: { ...row, deleted_at: gone, merged_into: other.id, absorbed: false }, merged: String(row.id) };
}

/** Where a night's dreams belong: the night it was merged into, followed to the end (a merged night can be merged again). */
async function survivorOf(q: Sql, nightId: string): Promise<{ id: string; found: boolean }> {
  let id = nightId;
  for (let i = 0; i < 20; i++) {
    const r = (await q.query("SELECT merged_into FROM nights WHERE id = $1", [id])).rows[0];
    if (!r) return { id, found: i > 0 };
    if (r.merged_into == null) return { id, found: true };
    id = String(r.merged_into);
  }
  return { id, found: true };
}

/**
 * The night fields a merge carries over. A merge never hides someone's words: free text that differs on the two nights
 * is joined on the survivor (its own value first, a blank line, then the other's), and when one text already holds the
 * other the longer stays, which also makes merging again change nothing. Technique lists are joined too (the
 * survivor's order first). Other plain values (times, ratings, booleans): newest updated_at wins, and a field the
 * survivor lacks is filled.
 */
const NIGHT_TEXT = ["substances", "notes", "intention"];
const NIGHT_LISTS = ["techniques_planned", "techniques_done"];
const NIGHT_PLAIN = ["bedtime", "wake_time", "sleep_quality", "wbtb_used", "wbtb_wake_at", "wbtb_minutes_awake", "caffeine_after", "alcohol"];
const isSet = (v: unknown) => v != null && v !== false && v !== "" && !(Array.isArray(v) && !v.length);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export function joinText(survivor: string, other: string): string {
  if (survivor.includes(other)) return survivor;
  if (other.includes(survivor)) return other;
  return `${survivor}\n\n${other}`;
}
export function mergeNightFields(survivor: Record<string, unknown>, loser: Record<string, unknown>): Record<string, unknown> {
  const newer = time(loser.updated_at) > time(survivor.updated_at);
  const patch: Record<string, unknown> = {};
  for (const f of NIGHT_TEXT) {
    const l = loser[f], s = survivor[f];
    if (!isSet(l)) continue;
    const v = isSet(s) ? joinText(String(s), String(l)) : l;
    if (v !== s) patch[f] = v;
  }
  for (const f of NIGHT_LISTS) {
    const s = Array.isArray(survivor[f]) ? survivor[f] as unknown[] : [], l = Array.isArray(loser[f]) ? loser[f] as unknown[] : [];
    const v = [...s, ...l.filter((x) => !s.includes(x))];
    if (v.length !== s.length) patch[f] = v;
  }
  for (const f of NIGHT_PLAIN) {
    const l = loser[f], s = survivor[f];
    if (isSet(l) && (!isSet(s) || (newer && !same(l, s)))) patch[f] = l;
  }
  return patch;
}

/**
 * After a page of changes: every merged night's dreams move to its survivor (only night_id changes: dreams keep
 * their ids, so their sealed values still open). On a device (absorb), the merged night's fields are copied into the
 * survivor once, by mergeNightFields (joined text stays readable: nothing anyone wrote is hidden): the device holds plaintext, and sealing on the way out binds the copied notes
 * to the survivor's id; the server can't do this part, it never opens a sealed value. Answers the rows changed, which
 * a device must send (it writes the server's rows without logging them).
 */
async function settleMerged(q: Sql, absorb: boolean): Promise<{ tbl: string; pk: Record<string, unknown> }[]> {
  const out: { tbl: string; pk: Record<string, unknown> }[] = [];
  const merged = (await q.query(`SELECT to_jsonb(n) AS r FROM nights n WHERE merged_into IS NOT NULL
    AND (${absorb ? "NOT absorbed OR " : ""}EXISTS (SELECT 1 FROM dreams d WHERE d.night_id = n.id))`)).rows.map((x: any) => x.r as Record<string, unknown>);
  for (const loser of merged) {
    const to = await survivorOf(q, String(loser.id));
    if (!to.found || to.id === loser.id) continue;
    for (const d of (await q.query("UPDATE dreams SET night_id = $2 WHERE night_id = $1 RETURNING id", [loser.id, to.id])).rows)
      out.push({ tbl: "dreams", pk: { id: d.id } });
    if (!absorb || loser.absorbed) continue;
    const survivor = (await q.query("SELECT to_jsonb(x) AS r FROM nights x WHERE id = $1 AND deleted_at IS NULL", [to.id])).rows[0]?.r;
    if (!survivor) continue; // its survivor was deleted, or hasn't arrived yet: tried again on a later page
    const patch = mergeNightFields(survivor, loser);
    const cols = Object.keys(patch);
    if (cols.length) {
      await q.query(`UPDATE nights SET (${cols.join(", ")}, updated_at) = (SELECT ${cols.map((k) => `p.${k}`).join(", ")}, greatest(nights.updated_at, $3::timestamptz)
        FROM jsonb_populate_record(NULL::nights, $2::jsonb) p) WHERE id = $1`, [to.id, JSON.stringify(patch), loser.updated_at]);
      out.push({ tbl: "nights", pk: { id: to.id } });
    }
    await q.query("UPDATE nights SET absorbed = true WHERE id = $1", [loser.id]);
    out.push({ tbl: "nights", pk: { id: loser.id } });
  }
  return out;
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
  // rows a device changed itself while settling (merges): it sends them, since its writes here aren't logged
  const touched: { tbl: string; pk: Record<string, unknown> }[] = [];
  let nights = list.some((c) => c.tbl === "nights" || c.tbl === "dreams");
  for (const c of list) {
    const def = SYNCED_BY_NAME.get(c.tbl)!;
    await q.query("SAVEPOINT somnium_row");
    try {
      if (opts.origin != null) await q.query("SELECT set_config('somnium.sync_origin', $1, true), set_config('somnium.sync_at', $2, true)", [opts.origin, c.at]);
      if (c.op === "upsert") {
        const all = await columns(q, c.tbl);
        // a row always belongs to whoever is writing it, whatever the JSON says
        let row: Record<string, unknown> = { ...c.row, ...(all.includes("user_id") ? { user_id: userId } : {}) };
        // what the merge rules write is logged for every device: the one that sent this row has to hear it too
        const aside = async () => { if (opts.origin != null) await q.query("SELECT set_config('somnium.sync_origin', '', true)"); };
        if (c.tbl === "nights") {
          const n = await settleNight(q, c, row, aside);
          if (n.merged) { row = n.row; nights = true; if (opts.apply) touched.push({ tbl: "nights", pk: { id: n.merged } }); }
        }
        if (c.tbl === "dreams" && typeof row.night_id === "string") {
          // a dream made offline under a night that has since been merged goes to the survivor
          const to = await survivorOf(q, row.night_id);
          if (to.id !== row.night_id) { row = { ...row, night_id: to.id }; await aside(); if (opts.apply) touched.push({ tbl: "dreams", pk: { id: row.id } }); }
        }
        const settled = await settleDuplicate(q, c, row, aside);
        const lost = settled.lost;
        row = settled.row;
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
  if (nights) {
    // its own savepoint: if it fails, the rows above still stand and the next page tries again
    await q.query("SAVEPOINT somnium_merge");
    try {
      if (opts.origin != null) await q.query("SELECT set_config('somnium.sync_origin', '', true)");
      touched.push(...await settleMerged(q, !!opts.apply));
      await q.query("RELEASE SAVEPOINT somnium_merge");
    } catch { await q.query("ROLLBACK TO SAVEPOINT somnium_merge"); }
  }
  if (opts.apply) await q.query("SELECT set_config('somnium.sync_apply', '', true)");
  const seen = new Set<string>();
  const changed = opts.apply ? touched.filter((t) => !seen.has(keyOf(t.tbl, t.pk)) && !!seen.add(keyOf(t.tbl, t.pk))) : [];
  return { applied: list.length - failed.length - kept.length, failed, kept, changed };
}

/** The latest change per row among log entries (oldest first, as they come from the log). */
export function latestPerRow<T extends { tbl: string; pk: Record<string, unknown> }>(entries: T[]): T[] {
  const m = new Map<string, T>();
  for (const e of entries) { const k = keyOf(e.tbl, e.pk); m.delete(k); m.set(k, e); }
  return [...m.values()];
}
