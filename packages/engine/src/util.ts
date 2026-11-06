// Small helpers shared by the modules.
import { bad } from "./errors";
import { isUuid } from "./ids";

/** snake_case row → camelCase object */
export function camel<T = any>(row: Record<string, unknown>): T {
  const o: Record<string, unknown> = {};
  for (const k of Object.keys(row)) o[k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())] = row[k];
  return o as T;
}
export const camels = <T = any>(rows: Record<string, unknown>[]) => rows.map((r) => camel<T>(r));

export function id(v: unknown, what = "id"): string {
  if (!isUuid(v)) throw bad(`Invalid ${what}`);
  return v;
}
export const optId = (v: unknown) => (v == null || v === "" ? null : id(v));
export function str(v: unknown, max = 2000, fallback = ""): string {
  if (v == null) return fallback;
  if (typeof v !== "string") throw bad("Expected text");
  return v.slice(0, max);
}
export function numOrNull(v: unknown, min = -1e9, max = 1e9): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw bad("Invalid number");
  return n;
}
export const intOrNull = (v: unknown, min = -1e9, max = 1e9) => { const n = numOrNull(v, min, max); return n == null ? null : Math.round(n); };
export const bool = (v: unknown, fallback = false) => (typeof v === "boolean" ? v : fallback);
export function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(v as T) ? (v as T) : fallback;
}
export function dateStr(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw bad("Invalid date");
  return v;
}
export function isoTime(v: unknown, fallback?: string): string {
  if (v == null || v === "") { if (fallback) return fallback; throw bad("Missing time"); }
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) throw bad("Invalid time");
  return d.toISOString();
}
/** The instant a calendar day (YYYY-MM-DD) starts for an app tzMin minutes behind UTC. */
export const startOfDay = (day: string, tzMin: number) => new Date(new Date(day + "T00:00:00Z").getTime() + tzMin * 60000);
/** The app's offset: the one it sends, else (an older app) the process's, which is the device's own on the device. */
export const tzOf = (qs: Record<string, string>) => (qs.tz != null && qs.tz !== "" && Number.isFinite(Number(qs.tz)) ? Number(qs.tz) : new Date().getTimezoneOffset());
export const secondsBetween = (a: string, b: string | Date) => Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 1000));

/** Refuses a reference to a row this person cannot see (row-level security hides other people's rows,
 *  but foreign keys are checked without it, so references are checked here). */
export async function visible(q: { query: (t: string, p?: unknown[]) => Promise<{ rows: unknown[] }> }, table: string, rowId: string | null | undefined, what = "item") {
  if (rowId == null) return;
  if (!(await q.query(`SELECT 1 FROM ${table} WHERE id = $1`, [rowId])).rows.length) throw bad(`Unknown ${what}`);
}
