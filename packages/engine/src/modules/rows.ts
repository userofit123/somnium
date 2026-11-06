// What every journal table shares: reading live rows (deleted_at IS NULL), writing with the body's fields checked,
// and removing by marking (soft delete, so the removal syncs like any other change). user_id always comes from
// the signed-in person, never from the body.
import type { Change } from "@somnium/shared";
import type { Ctx } from "../router";
import type { Sql } from "../db";
import { camel, camels, str, isoTime } from "../util";
import { bad, notFound } from "../errors";
import { uuidv7 } from "../ids";

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
/** A sealed column: the envelope string the device made, or nothing. Long, because it holds the whole dream text. */
export const sealed: Field = (v) => (v == null || v === "" ? null : str(v, 500_000));
export const timeOrNull: Field = (v) => (v == null || v === "" ? null : isoTime(v));
export const clockOrNull: Field = (v) => { if (v == null || v === "") return null; if (typeof v !== "string" || !/^\d{2}:\d{2}(:\d{2})?$/.test(v)) throw bad("Invalid time of day"); return v; };
export const idList: Field = (v) => (Array.isArray(v) ? v.slice(0, 50).map((x) => str(x, 80)) : []);
export const enumOrNull = (allowed: readonly string[]): Field => (v) => { if (v == null || v === "") return null; if (!allowed.includes(v as string)) throw bad(`Expected one of ${allowed.join(", ")}`); return v; };
export const enumOf = (allowed: readonly string[], fallback: string): Field => (v) => (v == null ? fallback : enumOrNull(allowed)(v));
export const required = (f: Field, what: string): Field => (v) => { const x = f(v); if (x == null) throw bad(`Missing ${what}`); return x; };
export const json: Field = (v) => { if (v == null) return "{}"; if (typeof v !== "object") throw bad("Expected an object"); const s = JSON.stringify(v); if (s.length > 20_000) throw bad("Too large"); return s; };

export async function listLive<T extends object>(q: Sql, table: string, where = "", params: unknown[] = [], order = "created_at DESC", limit = 500): Promise<T[]> {
  const { rows } = await q.query<Record<string, unknown>>(`SELECT * FROM ${table} WHERE deleted_at IS NULL${where ? ` AND ${where}` : ""} ORDER BY ${order} LIMIT ${limit}`, params);
  return camels<T>(rows);
}

export async function getLive<T extends object>(q: Sql, table: string, id: string, what = "item"): Promise<T> {
  const r = (await q.query<Record<string, unknown>>(`SELECT * FROM ${table} WHERE id = $1 AND deleted_at IS NULL`, [id])).rows[0];
  if (!r) throw notFound(`Unknown ${what}`);
  return camel<T>(r);
}

export async function insertRow<T extends object>(ctx: Ctx, table: string, topic: Change, cols: Record<string, unknown>): Promise<T> {
  const row = { id: uuidv7(), user_id: ctx.userId, ...cols };
  const keys = Object.keys(row);
  const r = (await ctx.q.query<Record<string, unknown>>(`INSERT INTO ${table} (${keys.join(", ")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING *`, Object.values(row))).rows[0]!;
  ctx.changed(topic);
  return camel<T>(r);
}

export async function updateRow<T extends object>(ctx: Ctx, table: string, topic: Change, id: string, cols: Record<string, unknown>, what = "item"): Promise<T> {
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
