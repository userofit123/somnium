// A device's copy of a person's data on a server (offline use). The app works on this copy; sync() in the app sends
// what changed here and fetches what changed elsewhere. Kept in app_meta: where in the server's log this copy is,
// how much of its own log has been sent, and this device's name for itself.
import type { Db, Sql } from "../db";
import { SYNCED } from "./tables";
import { readRows, applyChanges, latestPerRow, keyOf, overrule, DELETES_WIN, type Change } from "./core";
import { needsKey, sealChanges, unsealChanges } from "./sealing";
import { uuidv7 } from "../ids";
import { SEALED_TABLES } from "../sealed";

// Rows cross the device/server line only here (sealing.ts): sealed tables leave sealed and arrive opened, under the
// account's data key. Without the key (null) a sealed table's rows are refused with a LockedError before anything
// is sent or written; tables with nothing sealed (settings, goals, reminders) still travel, through plainChanges,
// markPlainSent and takePlain below.

// plainCursor: how far a locked device has read for plain tables; cursor stays put so sealed rows still arrive after
// unlocking. unopened: rows from the server that did not open, still as they came (ciphertext), tried again on
// every later pull so that a key problem that gets fixed loses nothing. heldBack: rows that opened but couldn't be
// written yet (their parent is set aside, or is still on a later page), kept the same way and tried again with them.
// They stay as they came so that each try opens them exactly once: opening an already opened row would mistake a
// text that merely looks like an envelope for a sealed value.
export interface ReplicaMeta { cursor: number; pushed: number; device: string; ready: boolean; plainCursor?: number; unopened?: Change[]; heldBack?: Change[] }

export const replicaMeta = (db: Db) => metaOf(db.admin);
async function metaOf(q: Sql): Promise<ReplicaMeta> {
  const r = (await q.query("SELECT value FROM app_meta WHERE key = 'replica'")).rows[0]?.value;
  return { cursor: 0, pushed: 0, device: "", ready: false, ...(r ?? {}) };
}
async function saveMeta(db: Db, patch: Partial<ReplicaMeta>) {
  const next = { ...(await replicaMeta(db)), ...patch };
  await db.admin.query("INSERT INTO app_meta (key, value) VALUES ('replica', $1) ON CONFLICT (key) DO UPDATE SET value = $1", [JSON.stringify(next)]);
  return next;
}

/** The first full copy: the person, then every table, parents first. Nothing of this is sent back. */
export async function loadSnapshot(db: Db, snap: { cursor: number; user: any; tables: Record<string, Record<string, unknown>[]> }, dataKey: Uint8Array | null = null) {
  // opened before the transaction: a locked device then leaves the copy untouched. A row that doesn't open is set
  // aside like one from a pull, so one bad row can't stop the first copy for good.
  const tables: Record<string, Record<string, unknown>[]> = {};
  const unopened: Change[] = [], heldBack: Change[] = [];
  const asCame = new Map<string, Change>();
  const pkOf = (t: { pk: string[] }, row: Record<string, unknown>) => Object.fromEntries(t.pk.map((c) => [c, row[c]]));
  for (const t of SYNCED) {
    const at = new Date().toISOString();
    const list = (snap.tables[t.name] ?? []).map((row): Change => ({ tbl: t.name, pk: pkOf(t, row), op: "upsert", at, row }));
    for (const c of list) asCame.set(keyOf(c.tbl, c.pk), c);
    const res = await unsealChanges(list, dataKey);
    tables[t.name] = res.opened.map((c) => c.row!);
    unopened.push(...res.unopened);
  }
  await db.tx(async (q) => {
    await q.query("SELECT set_config('somnium.sync_apply', '1', true)");
    const u = snap.user;
    await q.query(`INSERT INTO users (id, username, display_name, email, role) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (id) DO UPDATE SET username = $2, display_name = $3, email = $4, role = $5`, [u.id, u.username, u.display_name ?? "", u.email ?? null, u.role ?? "user"]);
    for (const t of SYNCED) {
      const rows = tables[t.name]!;
      const insert = (part: unknown[]) => q.query(`INSERT INTO ${t.name} SELECT * FROM jsonb_populate_recordset(NULL::${t.name}, $1::jsonb) ON CONFLICT DO NOTHING`, [JSON.stringify(part)]);
      if (!unopened.length) { for (let i = 0; i < rows.length; i += 200) await insert(rows.slice(i, i + 200)); continue; }
      // a row set aside leaves its children pointing at nothing: one at a time, so only those children stay out,
      // and they are held back to return when their parent opens (applyRemote tries them on every pull)
      for (const row of rows) {
        await q.query("SAVEPOINT snap_row");
        try { await insert([row]); await q.query("RELEASE SAVEPOINT snap_row"); }
        catch { await q.query("ROLLBACK TO SAVEPOINT snap_row"); heldBack.push(asCame.get(keyOf(t.name, pkOf(t, row)))!); }
      }
    }
  });
  const pushed = Number((await db.admin.query("SELECT coalesce(max(seq), 0) AS s FROM sync_log")).rows[0].s);
  return saveMeta(db, { cursor: snap.cursor, pushed, device: (await replicaMeta(db)).device || uuidv7(), ready: true, unopened, heldBack });
}

/** What changed here since the last send (the latest change per row, sealed for the server), and up to where in the log that goes. */
export async function localChanges(db: Db, limit = 500, dataKey: Uint8Array | null = null): Promise<{ changes: Change[]; upTo: number }> {
  const m = await replicaMeta(db);
  const log = (await db.admin.query("SELECT seq, tbl, pk, op, at FROM sync_log WHERE seq > $1 ORDER BY seq LIMIT $2", [m.pushed, limit])).rows;
  if (!log.length) return { changes: [], upTo: m.pushed };
  const latest = latestPerRow(log as any[]);
  const rows = await readRows(db.admin, latest.filter((e: any) => e.op === "upsert"));
  const changes: Change[] = latest.map((e: any) => { const row = e.op === "upsert" ? rows.get(keyOf(e.tbl, e.pk)) ?? null : null; return { tbl: e.tbl, pk: e.pk, op: row ? "upsert" : "delete", at: new Date(e.at).toISOString(), row }; });
  return { upTo: Number(log.at(-1).seq), changes: await sealChanges(changes, dataKey) };
}
/** While locked: what changed here in tables with nothing sealed, and up to where in the log that was read. */
export async function plainChanges(db: Db, limit = 500): Promise<{ changes: Change[]; upTo: number }> {
  const m = await replicaMeta(db);
  const log = (await db.admin.query("SELECT seq, tbl, pk, op, at FROM sync_log WHERE seq > $1 AND NOT (tbl = ANY($2::text[])) ORDER BY seq LIMIT $3", [m.pushed, SEALED_TABLES, limit])).rows;
  if (!log.length) return { changes: [], upTo: m.pushed };
  const latest = latestPerRow(log as any[]);
  const rows = await readRows(db.admin, latest.filter((e: any) => e.op === "upsert"));
  const changes: Change[] = latest.map((e: any) => { const row = e.op === "upsert" ? rows.get(keyOf(e.tbl, e.pk)) ?? null : null; return { tbl: e.tbl, pk: e.pk, op: row ? "upsert" : "delete", at: new Date(e.at).toISOString(), row }; });
  return { upTo: Number(log.at(-1).seq), changes };
}
/** The server has those plain changes: forget them. The position stays, because sealed changes before them still wait. */
export async function markPlainSent(db: Db, upTo: number) {
  await db.admin.query("DELETE FROM sync_log WHERE seq > $1 AND seq <= $2 AND NOT (tbl = ANY($3::text[]))", [(await replicaMeta(db)).pushed, upTo, SEALED_TABLES]);
}
/** While locked: where the next pull starts, past what was already read for plain tables. */
export const plainSince = async (db: Db) => { const m = await replicaMeta(db); return Math.max(m.cursor, m.plainCursor ?? 0); };
/** While locked: applies only the plain tables of a pulled page. Sealed rows are left for after unlocking, when the real cursor reads this page again. */
export async function takePlain(db: Db, userId: string, remote: Change[], plainCursor: number) {
  const res = await applyRemote(db, userId, remote.filter((c) => !needsKey(c.tbl)), undefined, null);
  await saveMeta(db, { plainCursor });
  return res;
}

/** The server has them: forget them here. */
export async function markSent(db: Db, upTo: number) {
  await db.admin.query("DELETE FROM sync_log WHERE seq <= $1", [upTo]);
  await saveMeta(db, { pushed: upTo });
}
/** Rows not yet sent to the server, for "N changes waiting". */
export async function waitingCount(db: Db) {
  const m = await replicaMeta(db);
  return Number((await db.admin.query("SELECT count(DISTINCT (tbl, pk)) AS n FROM sync_log WHERE seq > $1", [m.pushed])).rows[0].n);
}

/**
 * Writes the server's changes into this copy. A row changed here more recently (and not yet sent) keeps this
 * device's version; it goes to the server on the next send, where the newest wins again. overrule() decides first
 * (a deletion in a DELETES_WIN table is final on both sides, whatever was changed meanwhile).
 */
export async function applyRemote(db: Db, userId: string, remote: Change[], cursor?: number, dataKey: Uint8Array | null = null) {
  // rows set aside or held back earlier go round again, unless a newer version of the same row has just arrived.
  // Without a key the sealed ones just stay where they are: they are ciphertext.
  const before = await replicaMeta(db);
  const incoming = new Set(remote.map((c) => keyOf(c.tbl, c.pk)));
  const notReplaced = (c: Change) => !incoming.has(keyOf(c.tbl, c.pk));
  const setAside = (before.unopened ?? []).filter(notReplaced), waiting = (before.heldBack ?? []).filter(notReplaced);
  const asCame = [...(dataKey ? [...setAside, ...waiting] : waiting.filter((c) => !needsKey(c.tbl))), ...remote];
  const { opened: changes, unopened } = await unsealChanges(asCame, dataKey);
  const cameAs = new Map(asCame.map((c) => [keyOf(c.tbl, c.pk), c]));
  const stillUnopened = dataKey ? unopened : [...setAside, ...unopened];
  const stillWaiting = dataKey ? [] : waiting.filter((c) => needsKey(c.tbl));
  const res = await db.tx(async (q) => {
    // read inside the same transaction as the writes: a change made here in between (finishing, say) is then either
    // seen here, or made after these writes; never overwritten by an older version of the row
    const m = await metaOf(q);
    const mine = new Map<string, { at: number; op: string }>();
    for (const e of (await q.query("SELECT DISTINCT ON (tbl, pk) tbl, pk, op, at FROM sync_log WHERE seq > $1 ORDER BY tbl, pk, seq DESC", [m.pushed])).rows)
      mine.set(keyOf(e.tbl, e.pk), { at: new Date(e.at).getTime(), op: e.op });
    const here = await readRows(q, changes.filter((c) => DELETES_WIN.has(c.tbl)));
    const keep: Change[] = [];
    const take = changes.filter((c) => {
      const k = keyOf(c.tbl, c.pk), t = mine.get(k);
      const o = overrule(c, { row: here.get(k) ?? null, lastOp: t?.op ?? null });
      if (o === false) keep.push(c);
      return o ?? (t == null || t.at <= new Date(c.at).getTime());
    });
    const r = await applyChanges(q, userId, take, { apply: true });
    // the server's version replaced an older change made here: that one need not be sent any more
    for (const c of take) await q.query("DELETE FROM sync_log WHERE seq > $1 AND tbl = $2 AND pk = $3::jsonb", [m.pushed, c.tbl, JSON.stringify(c.pk)]);
    // this copy's version stands against the server's: send it (again), so the server ends up the same
    // and rows this copy changed itself while settling (two nights merged, LDJ-52): the server has to hear of them
    for (const c of [...keep, ...r.kept, ...r.changed]) {
      const row = (await readRows(q, [c])).get(keyOf(c.tbl, c.pk));
      await q.query("INSERT INTO sync_log (user_id, tbl, pk, op) VALUES ($1, $2, $3::jsonb, $4)", [userId, c.tbl, JSON.stringify(c.pk), row ? "upsert" : "delete"]);
    }
    return r;
  });
  // a row that couldn't be written is never dropped: the cursor moves past it, so this list is all that remembers it
  const heldBack = [...stillWaiting, ...res.failed.map((f) => cameAs.get(keyOf(f.change.tbl, f.change.pk))!)];
  await saveMeta(db, { ...(cursor != null ? { cursor } : {}), unopened: stillUnopened, heldBack });
  return { ...res, unopened: stillUnopened.length, heldBack: heldBack.length };
}
