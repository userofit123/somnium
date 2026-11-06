// Reading and writing synced rows, the same way on the server and on a device.
// Rows travel as JSON made by to_jsonb and are written back with jsonb_populate_record, so every column type round-trips.
import { hkdf, toBase64url } from "@somnium/shared";
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

type Row = Record<string, unknown>;
type Key = { tbl: string; pk: Record<string, unknown> };

/** The merge rule's order: made first (created_at), then the lower id. Every device and the server compute it alike. */
const madeBefore = (a: Row, b: Row) => { const x = time(a.created_at), y = time(b.created_at); return x !== y ? x < y : String(a.id) < String(b.id); };
/** Whether night n may be merged into t: the same person and date, t not a nap, and t made before n. */
const mayMergeInto = (n: Row, t: Row) => t.user_id === n.user_id && String(t.date) === String(n.date) && t.nap !== true && madeBefore(t, n);
const nightRow = async (q: Sql, id: unknown, userId?: unknown): Promise<Row | undefined> =>
  (await q.query(`SELECT to_jsonb(x) AS r FROM nights x WHERE id = $1${userId != null ? " AND user_id = $2" : ""}`, userId != null ? [id, userId] : [id])).rows[0]?.r;
const deletedAt = (a: Row, b: Row) => new Date(Math.max(time(a.updated_at), time(b.updated_at))).toISOString();

/**
 * A night as it arrives (server and device alike). Its created_at is required: the merge rule is decided by it, and
 * falling back to the change's time would let two places decide differently. A live night is merged into nothing
 * (a restore clears merged_into). A deleted night's merged_into is the sender's claim and is kept as it came: it is
 * checked wherever it is followed (survivorOf), and a claim that fails is settled there, the same way on every side.
 */
function checkNight(row: Row): Row {
  if (Number.isNaN(Date.parse(String(row.created_at ?? "")))) throw new Error("A night must say when it was made (created_at)");
  return row.deleted_at == null && row.merged_into != null ? { ...row, merged_into: null } : row;
}

/**
 * Two live nights for one date (LDJ-52; the unique index nights_user_date_live). They are merged, not refused: the
 * night made first survives (madeBefore), whichever arrives first. The other is soft-deleted under its own id with
 * merged_into pointing at the survivor (its updated_at stays, so its fields can still be weighed against the
 * survivor's). Its dreams move over afterwards (settleMerged). Naps are never merged. aside(): as in settleDuplicate.
 * Answers the row to write and the night that lost, if any.
 */
async function settleNight(q: Sql, row: Row, aside: () => Promise<void>): Promise<{ row: Row; merged: string | null }> {
  if (row.deleted_at != null || row.nap === true || row.date == null) return { row, merged: null };
  const other = (await q.query(`SELECT to_jsonb(x) AS r FROM nights x WHERE id <> $1 AND user_id = $2 AND date = $3::date AND deleted_at IS NULL AND NOT nap`,
    [row.id, row.user_id, row.date])).rows[0]?.r as Row | undefined;
  if (!other) return { row, merged: null };
  await aside();
  if (madeBefore(row, other)) {
    await q.query("UPDATE nights SET deleted_at = $2, merged_into = $3 WHERE id = $1", [other.id, deletedAt(row, other), row.id]);
    return { row, merged: String(other.id) };
  }
  return { row: { ...row, deleted_at: deletedAt(row, other), merged_into: other.id }, merged: String(row.id) };
}

/**
 * Where a merged night's dreams belong: along merged_into to the end (a merged night can be merged again, A into B
 * into C). Each step must be a deleted night whose link keeps the rule, to a night of the same person.
 * live: the end is a live night. broken: there is no live night to go to (the person deleted the survivor, or a link
 * breaks the rule). waiting: the next night isn't here. Only a device waits (the night may still be on its way in a
 * later page); on the server every night a device can merge into is already there (it came from the server, or
 * earlier in the same push), so a missing one, or another person's, is a broken link.
 */
async function survivorOf(q: Sql, nightId: unknown, device: boolean): Promise<{ id: string; state: "live" | "broken" | "waiting" }> {
  let cur = await nightRow(q, nightId);
  if (!cur) return { id: String(nightId), state: device ? "waiting" : "broken" };
  for (let i = 0; i < 20; i++) {
    if (cur.deleted_at == null) return { id: String(cur.id), state: "live" };
    if (cur.merged_into == null) return { id: String(cur.id), state: "broken" };
    const t = await nightRow(q, cur.merged_into, cur.user_id);
    if (!t) return { id: String(cur.id), state: device ? "waiting" : "broken" };
    if (!mayMergeInto(cur, t)) return { id: String(cur.id), state: "broken" };
    cur = t;
  }
  return { id: String(cur.id), state: "broken" };
}

/**
 * The night fields a merge carries over. A merge never hides someone's words: free text that differs on the two nights
 * is joined on the survivor (its own value first, a blank line, then the other's), and when one text already holds the
 * other the longer stays. Technique lists are joined too (the survivor's order first). Other plain values (times,
 * ratings, booleans): newest updated_at wins, and a field the survivor lacks is filled.
 */
const NIGHT_TEXT = ["substances", "notes", "intention"];
const NIGHT_LISTS = ["techniques_planned", "techniques_done"];
const NIGHT_PLAIN = ["bedtime", "wake_time", "sleep_quality", "wbtb_used", "wbtb_wake_at", "wbtb_minutes_awake", "caffeine_after", "alcohol", "no_recall"];
const isSet = (v: unknown) => v != null && v !== false && v !== "" && !(Array.isArray(v) && !v.length);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export function joinText(survivor: string, other: string): string {
  if (survivor.includes(other)) return survivor;
  if (other.includes(survivor)) return other;
  return `${survivor}\n\n${other}`;
}

/** Fingerprints a text for the absorbed record: a fingerprint function, keyed (HMAC) so it says nothing without the key. */
export type Fingerprint = (text: string) => Promise<string>;
/**
 * The device's fingerprint: HMAC-SHA256 under a key derived from the data key (HKDF, its own info string), cut to 128
 * bits. Keyed, so even outside its sealed column a fingerprint of a short text ("tea") couldn't be guessed.
 */
export async function nightFingerprint(dataKey: Uint8Array): Promise<Fingerprint> {
  const raw = await hkdf(dataKey, new Uint8Array(32), "somnium-night-merge");
  const key = await globalThis.crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return async (text) => toBase64url(new Uint8Array(await globalThis.crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text))).slice(0, 16));
}

/**
 * The absorbed record (sealed, sealed.ts). On a survivor: per merged night, the fingerprint of each of its texts
 * already joined in. On a merged night: given, once its plain values and technique lists were handed to its survivor.
 */
type Absorbed = { given?: boolean } & Record<string, Record<string, string> | boolean | undefined>;
const absorbedOf = (row: Row): Absorbed => { try { const v = JSON.parse(String(row.absorbed ?? "{}")); return v && typeof v === "object" ? v : {}; } catch { return {}; } };

/**
 * What absorbing a merged night changes, on the survivor and on the merged night itself. Self-healing rather than
 * one-shot: it is worked out again whenever either night changes, so a joined survivor that lost to another version of
 * its row (an older copy, an edit from somewhere that hadn't heard of the merge, a log time that put it behind) is
 * joined again. What keeps it from bringing back text the person deliberately removed is the survivor's record: a
 * text whose fingerprint is there is never added again; one that isn't (never taken in, or the record went with a
 * lost version of the row) is. The record lives on the survivor, so it travels in the same row as the text it
 * describes. Plain values and technique lists are handed over once, ever: the merged night records that it gave them
 * (given), so a technique the person removed later never comes back, whatever happens to the survivor's row.
 */
export async function mergeNightFields(survivor: Row, loser: Row, fp: Fingerprint): Promise<{ survivor: Row; loser: Row }> {
  const rec = absorbedOf(survivor), mine = absorbedOf(loser), id = String(loser.id);
  const had = typeof rec[id] === "object" ? rec[id] as Record<string, string> : undefined;
  const entry: Record<string, string> = { ...(had ?? {}) };
  const patch: Row = {}, own: Row = {};
  for (const f of NIGHT_TEXT) {
    const l = loser[f], s = survivor[f];
    if (!isSet(l)) continue;
    const print = await fp(String(l));
    if (entry[f] === print) continue;
    entry[f] = print;
    const v = isSet(s) ? joinText(String(s), String(l)) : l;
    if (v !== s) patch[f] = v;
  }
  if (!mine.given) {
    const newer = time(loser.updated_at) > time(survivor.updated_at);
    for (const f of NIGHT_LISTS) {
      const s = Array.isArray(survivor[f]) ? survivor[f] as unknown[] : [], l = Array.isArray(loser[f]) ? loser[f] as unknown[] : [];
      const v = [...s, ...l.filter((x) => !s.includes(x))];
      if (v.length !== s.length) patch[f] = v;
    }
    for (const f of NIGHT_PLAIN) {
      const l = loser[f], s = survivor[f];
      if (isSet(l) && (!isSet(s) || (newer && !same(l, s)))) patch[f] = l;
    }
    own.absorbed = JSON.stringify({ ...mine, given: true });
  }
  if (!had || !same(entry, had)) patch.absorbed = JSON.stringify({ ...rec, [id]: entry });
  return { survivor: patch, loser: own };
}

const writeNight = (q: Sql, id: unknown, patch: Row, atLeast?: unknown) => {
  const cols = Object.keys(patch);
  return q.query(`UPDATE nights SET (${cols.join(", ")}, updated_at) = (SELECT ${cols.map((k) => `p.${k}`).join(", ")}, greatest(nights.updated_at, $3::timestamptz)
    FROM jsonb_populate_record(NULL::nights, $2::jsonb) p) WHERE id = $1`, [id, JSON.stringify(patch), atLeast ?? null]);
};

/**
 * A merged night with no live night to go to (survivorOf: broken). Its live dreams must not sit on a deleted night,
 * so it comes back as the night of its date; if another live night has that date by now, the two are settled by the
 * same rule (the one made first stays). With no live dreams it is left as it is: nothing would be hidden, and the
 * person may have deleted the night it was merged into on purpose. The same on the server and on every device.
 */
async function bringBack(q: Sql, night: Row, changed: (tbl: string, id: unknown) => void): Promise<boolean> {
  const live = Number((await q.query("SELECT count(*) AS n FROM dreams WHERE night_id = $1 AND deleted_at IS NULL", [night.id])).rows[0].n);
  if (!live) return false;
  const other = (await q.query(`SELECT to_jsonb(x) AS r FROM nights x WHERE id <> $1 AND user_id = $2 AND date = $3::date AND deleted_at IS NULL AND NOT nap`,
    [night.id, night.user_id, night.date])).rows[0]?.r as Row | undefined;
  if (other && night.nap !== true && madeBefore(other, night)) {
    if (night.merged_into === other.id) return false;
    await q.query("UPDATE nights SET merged_into = $2 WHERE id = $1", [night.id, other.id]);
  } else {
    if (other && night.nap !== true) { await q.query("UPDATE nights SET deleted_at = $2, merged_into = $3 WHERE id = $1", [other.id, deletedAt(night, other), night.id]); changed("nights", other.id); }
    await q.query("UPDATE nights SET deleted_at = NULL, merged_into = NULL WHERE id = $1", [night.id]);
  }
  changed("nights", night.id);
  return true;
}

/**
 * One merged night (settleMerged). Its dreams move to the survivor (only night_id changes: dreams keep their ids, so
 * their sealed values still open); on a device holding the key (fp), the two nights' fields are merged
 * (mergeNightFields): the device holds plaintext, and sealing on the way out binds the joined text to the survivor's
 * id. The server can't do that part, it never opens a sealed value. Answers whether anything changed, or "waiting".
 */
async function settleOne(q: Sql, loser: Row, fp: Fingerprint | null, device: boolean, changed: (tbl: string, id: unknown) => void): Promise<boolean | "waiting"> {
  const to = await survivorOf(q, loser.id, device);
  if (to.state === "waiting") return "waiting";
  if (to.state === "broken") return bringBack(q, loser, changed);
  let did = false;
  for (const d of (await q.query("UPDATE dreams SET night_id = $2 WHERE night_id = $1 RETURNING id", [loser.id, to.id])).rows) { changed("dreams", d.id); did = true; }
  if (!fp) return did;
  const survivor = (await nightRow(q, to.id))!;
  const m = await mergeNightFields(survivor, loser, fp);
  if (Object.keys(m.survivor).length) { await writeNight(q, to.id, m.survivor, loser.updated_at); changed("nights", to.id); did = true; }
  if (Object.keys(m.loser).length) { await writeNight(q, loser.id, m.loser); changed("nights", loser.id); did = true; }
  return did;
}

/**
 * After a page of changes: the merged nights this page touched are settled (settleOne), each on its own savepoint, so
 * one that fails stays as it is while the rest go through. Touched: a night of the page, the night a dream of the page
 * hangs off, the nights merged into any of those (followed down a chain), and those the caller still has pending
 * (failed or waiting last time: the device keeps that list). The cost follows the page, not the history. A failure
 * is counted and logged by its error code only (never a row's content). A few rounds, since settling one night can
 * touch another (a night brought back that takes over another). Answers the rows changed (a device must send them:
 * it writes the server's rows without logging them) and the nights still pending.
 */
async function settleMerged(q: Sql, touched: Set<string>, fp: Fingerprint | null, device: boolean): Promise<{ changed: Key[]; pending: string[]; failed: number }> {
  const out: Key[] = [];
  const bad = new Set<string>(), waiting = new Set<string>(), codes = new Set<string>();
  let ids = [...touched];
  for (let round = 0; round < 4 && ids.length; round++) {
    // the nights merged into these, and into those, down a chain
    const all = new Set(ids);
    for (let level = 0, next = ids; level < 20 && next.length; level++) {
      next = (await q.query("SELECT id FROM nights WHERE merged_into = ANY($1::uuid[]) AND deleted_at IS NOT NULL", [next])).rows.map((r: any) => String(r.id)).filter((x) => !all.has(x));
      for (const x of next) all.add(x);
    }
    // in the rule's order (made first, first), so every place joins texts in the same order and ends up the same
    const merged = (await q.query("SELECT to_jsonb(n) AS r FROM nights n WHERE id = ANY($1::uuid[]) AND deleted_at IS NOT NULL AND merged_into IS NOT NULL", [[...all]])).rows
      .map((x: any) => x.r as Row).sort((a, b) => (madeBefore(a, b) ? -1 : 1));
    const again = new Set<string>();
    const changed = (tbl: string, id: unknown) => { out.push({ tbl, pk: { id } }); if (tbl === "nights") again.add(String(id)); };
    for (const loser of merged) {
      const id = String(loser.id);
      if (bad.has(id)) continue;
      await q.query("SAVEPOINT somnium_merge");
      const mark = out.length;
      try {
        const r = await settleOne(q, loser, fp, device, changed);
        if (r === "waiting") waiting.add(id); else waiting.delete(id);
        await q.query("RELEASE SAVEPOINT somnium_merge");
      } catch (e) {
        await q.query("ROLLBACK TO SAVEPOINT somnium_merge");
        out.length = mark;
        bad.add(id); codes.add(String((e as { code?: unknown }).code ?? "unknown"));
      }
    }
    ids = [...again];
  }
  if (bad.size) console.warn(`sync: ${bad.size} merged night(s) could not be settled yet, tried again later (codes ${[...codes].join(", ")})`);
  return { changed: out, pending: [...new Set([...bad, ...waiting])], failed: bad.size };
}

/**
 * Writes changes made elsewhere: upserts parents first, then deletes children first.
 * Each row on its own savepoint, so one that no longer fits (its parent was deleted meanwhile) doesn't stop the rest.
 * origin: who made them (the server logs it, so that device isn't sent its own changes back); apply: a device writing
 * the server's rows (not logged at all). fingerprint: a device holding the data key (nightFingerprint), which merges
 * nights' fields; pending: merged nights still to settle from an earlier page (the device keeps them, ReplicaMeta).
 */
export async function applyChanges(q: Sql, userId: string, changes: Change[],
  opts: { origin?: string; apply?: boolean; fingerprint?: Fingerprint | null; pending?: string[] } = {}) {
  const ord = (c: Change) => SYNCED_BY_NAME.get(c.tbl)!.order;
  const list = [
    // a merged night after the live ones, so the night it was merged into is there when it is checked
    ...changes.filter((c) => c.op === "upsert" && c.row).sort((a, b) => ord(a) - ord(b) || Number(a.row!.merged_into != null) - Number(b.row!.merged_into != null)),
    ...changes.filter((c) => c.op === "delete").sort((a, b) => ord(b) - ord(a)),
  ];
  if (opts.apply) await q.query("SELECT set_config('somnium.sync_apply', '1', true)");
  const failed: { change: Change; error: string }[] = [];
  // upserts sent to the server that lost to another row (settleDuplicate): the device that sent them gets them back,
  // because the log won't send a device its own changes
  const kept: Change[] = [];
  // rows a device changed itself while settling (merges): it sends them, since its writes here aren't logged
  const touched: { tbl: string; pk: Record<string, unknown> }[] = [];
  // nights this page touched: settleMerged looks at these (and what was merged into them), never the whole history
  const nights = new Set<string>(opts.pending ?? []);
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
          row = checkNight(row);
          const n = await settleNight(q, row, aside);
          nights.add(String(row.id));
          if (n.merged) { row = n.row; nights.add(n.merged); if (opts.apply) touched.push({ tbl: "nights", pk: { id: n.merged } }); }
        }
        if (c.tbl === "dreams" && typeof row.night_id === "string") {
          // a dream made offline under a night that has since been merged goes to the survivor
          const to = await survivorOf(q, row.night_id, !!opts.apply);
          if (to.state === "live" && to.id !== row.night_id) { row = { ...row, night_id: to.id }; await aside(); if (opts.apply) touched.push({ tbl: "dreams", pk: { id: row.id } }); }
          nights.add(String(row.night_id));
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
  let mergeFailed = 0, pending: string[] = [];
  if (nights.size) {
    if (opts.origin != null) await q.query("SELECT set_config('somnium.sync_origin', '', true)");
    const m = await settleMerged(q, nights, opts.apply ? opts.fingerprint ?? null : null, !!opts.apply);
    touched.push(...m.changed);
    mergeFailed = m.failed; pending = m.pending;
  }
  if (opts.apply) await q.query("SELECT set_config('somnium.sync_apply', '', true)");
  const seen = new Set<string>();
  const changed = opts.apply ? touched.filter((t) => !seen.has(keyOf(t.tbl, t.pk)) && !!seen.add(keyOf(t.tbl, t.pk))) : [];
  return { applied: list.length - failed.length - kept.length, failed, kept, changed, mergeFailed, pending };
}

/** The latest change per row among log entries (oldest first, as they come from the log). */
export function latestPerRow<T extends { tbl: string; pk: Record<string, unknown> }>(entries: T[]): T[] {
  const m = new Map<string, T>();
  for (const e of entries) { const k = keyOf(e.tbl, e.pk); m.delete(k); m.set(k, e); }
  return [...m.values()];
}
