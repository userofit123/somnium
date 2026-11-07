// What every journal table shares: reading live rows (deleted_at IS NULL), writing with the body's fields checked,
// and removing by marking (soft delete, so the removal syncs like any other change). user_id always comes from
// the signed-in person, never from the body.
import type { Change } from "@somnium/shared";
import type { Ctx } from "../router";
import type { Sql } from "../db";
import { isSealed } from "@somnium/shared";
import { camel, camels, str, isoTime } from "../util";
import { bad, conflict, notFound } from "../errors";
import { isUuid, uuidv7 } from "../ids";
import { SEALED_COLUMNS } from "../sealed";

export type Field = (v: unknown) => unknown;
/** column → how its value is read from the body (under the camelCase name) */
export type Fields = Record<string, Field>;

const keyOf = (col: string) => col.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

/** The columns a body sets: every field for a new row (missing ones get the field's fallback), only the given ones for an edit. */
export function columns(fields: Fields, body: unknown, all: boolean): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw bad("Expected an object");
  const b = body as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [col, f] of Object.entries(fields)) { const k = keyOf(col); if (all || k in b) out[col] = f(b[k]); }
  return out;
}

// field readers beyond util.ts
// room for a 500,000-character text once sealed (base64 grows it by a third). Refused rather than cut: a cut
// envelope still looks like one, and would never open again.
const MAX_SEALED = 700_000;
/** A sealed column: the envelope string the device made, or nothing. Long, because it holds the whole dream text. */
export const sealed: Field = (v) => {
  if (v == null || v === "") return null;
  if (typeof v !== "string") throw bad("Expected text");
  if (v.length > MAX_SEALED) throw bad("That text is too long");
  return v;
};
export const timeOrNull: Field = (v) => (v == null || v === "" ? null : isoTime(v));
export const clockOrNull: Field = (v) => { if (v == null || v === "") return null; if (typeof v !== "string" || !/^\d{2}:\d{2}(:\d{2})?$/.test(v)) throw bad("Invalid time of day"); return v; };
export const idList: Field = (v) => (Array.isArray(v) ? v.slice(0, 50).map((x) => str(x, 80)) : []);
export const enumOrNull = (allowed: readonly string[]): Field => (v) => { if (v == null || v === "") return null; if (!allowed.includes(v as string)) throw bad(`Expected one of ${allowed.join(", ")}`); return v; };
export const enumOf = (allowed: readonly string[], fallback: string): Field => (v) => (v == null ? fallback : enumOrNull(allowed)(v));
export const required = (f: Field, what: string): Field => (v) => { const x = f(v); if (x == null) throw bad(`Missing ${what}`); return x; };
export const json: Field = (v) => { if (v == null) return "{}"; if (typeof v !== "object") throw bad("Expected an object"); const s = JSON.stringify(v); if (s.length > 20_000) throw bad("Too large"); return s; };

/** Defence in depth (PLAN.md §4.1): the server takes only envelopes in sealed columns, whatever a client sends. */
export function refusePlain(table: string, row: Record<string, unknown>) {
  for (const c of SEALED_COLUMNS[table] ?? []) {
    const v = row[c];
    if (v != null && !isSealed(v)) throw bad("This field must be sealed by the app");
  }
}

/** The id a device made for a new row: sealed values are bound to their row's id, so it has to be known before sealing. */
export function clientId(body: unknown): { id?: string } {
  const v = (body as Record<string, unknown> | null)?.id;
  if (v == null) return {};
  if (!isUuid(v)) throw bad("Invalid id");
  return { id: v };
}

/**
 * For routes where the server finds the row itself: a value sealed for another row would never open again. A sealed
 * value without an id can't be checked against the row, so a server refuses it, as insertRow does.
 */
export function refuseOtherRow(ctx: Ctx, table: string, body: unknown, cols: Record<string, unknown>, existingId: string) {
  const { id } = clientId(body);
  if (id && id !== existingId) throw conflict("This was changed on another device. Try again.");
  if (!id && ctx.mode === "server" && (SEALED_COLUMNS[table] ?? []).some((c) => cols[c] != null)) throw bad("This field must be sealed by the app");
}

export async function listLive<T extends object>(q: Sql, table: string, where = "", params: unknown[] = [], order = "created_at DESC", limit = 500): Promise<T[]> {
  const { rows } = await q.query<Record<string, unknown>>(`SELECT * FROM ${table} WHERE deleted_at IS NULL${where ? ` AND ${where}` : ""} ORDER BY ${order} LIMIT ${limit}`, params);
  return camels<T>(rows);
}

export async function getLive<T extends object>(q: Sql, table: string, id: string, what = "item"): Promise<T> {
  const r = (await q.query<Record<string, unknown>>(`SELECT * FROM ${table} WHERE id = $1 AND deleted_at IS NULL`, [id])).rows[0];
  if (!r) throw notFound(`Unknown ${what}`);
  return camel<T>(r);
}

/**
 * A create sent again with the id it was made with (the outbox resends one whose answer never arrived,
 * packages/shared/src/outbox.ts): the row it made is answered, as if made now, and nothing is announced again. Only
 * when it is this person's, still there, and every plain value is the same; a sealed one can only be compared by
 * being there or not (it is sealed afresh on each send, and the server never reads it). Anything else with that id
 * is a different row: 409.
 */
async function sameCreate<T extends object>(ctx: Ctx, table: string, cols: Record<string, unknown>): Promise<T | null> {
  const sealedCols = SEALED_COLUMNS[table] ?? [];
  const params: unknown[] = [cols.id, ctx.userId];
  const conds: string[] = [];
  for (const [k, v] of Object.entries(cols)) {
    if (k === "id") continue;
    if (sealedCols.includes(k)) { conds.push(`((${k} IS NULL) = ${v == null})`); continue; }
    params.push(v);
    conds.push(`${k} IS NOT DISTINCT FROM $${params.length}`);
  }
  const r = (await ctx.q.query<Record<string, unknown>>(
    `SELECT *, (deleted_at IS NULL${conds.length ? ` AND ${conds.join(" AND ")}` : ""}) AS same_as_sent FROM ${table} WHERE id = $1 AND user_id = $2`, params)).rows[0];
  if (!r) return null;
  if (!r.same_as_sent) throw conflict("Something else already has this id");
  const { same_as_sent: _same, ...row } = r;
  return camel<T>(row);
}

export async function insertRow<T extends object>(ctx: Ctx, table: string, topic: Change, cols: Record<string, unknown>): Promise<T> {
  if (ctx.mode === "server") {
    refusePlain(table, cols);
    // sealed for a row id the server would then make up: it could never be opened again
    if (!cols.id && (SEALED_COLUMNS[table] ?? []).some((c) => cols[c] != null)) throw bad("This field must be sealed by the app");
  }
  if (typeof cols.id === "string") {
    const same = await sameCreate<T>(ctx, table, cols);
    if (same) return same;
  }
  const row = { id: uuidv7(), user_id: ctx.userId, ...cols };
  const keys = Object.keys(row);
  const r = (await ctx.q.query<Record<string, unknown>>(`INSERT INTO ${table} (${keys.join(", ")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING *`, Object.values(row))).rows[0]!;
  ctx.changed(topic);
  return camel<T>(r);
}

export async function updateRow<T extends object>(ctx: Ctx, table: string, topic: Change, id: string, cols: Record<string, unknown>, what = "item"): Promise<T> {
  if (ctx.mode === "server") refusePlain(table, cols);
  const keys = Object.keys(cols);
  const set = [...keys.map((k, i) => `${k} = $${i + 2}`), "updated_at = now()"];
  const r = (await ctx.q.query<Record<string, unknown>>(`UPDATE ${table} SET ${set.join(", ")} WHERE id = $1 AND deleted_at IS NULL RETURNING *`, [id, ...keys.map((k) => cols[k])])).rows[0];
  if (!r) throw notFound(`Unknown ${what}`);
  ctx.changed(topic);
  return camel<T>(r);
}

/** Marks the row gone; 404 when there is no live row to mark. */
export async function removeRow(ctx: Ctx, table: string, topic: Change, id: string, what = "item") {
  const r = (await ctx.q.query(`UPDATE ${table} SET deleted_at = now(), updated_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING id`, [id])).rows[0];
  if (!r) throw notFound(`Unknown ${what}`);
  ctx.changed(topic);
}
/** Marks every live row that matches gone (the rows hanging off a removed one, or a link by its two ends) and says how many. */
export const removeWhere = async (q: Sql, table: string, where: string, params: unknown[]): Promise<number> =>
  (await q.query(`UPDATE ${table} SET deleted_at = now(), updated_at = now() WHERE deleted_at IS NULL AND ${where} RETURNING id`, params)).rows.length;
