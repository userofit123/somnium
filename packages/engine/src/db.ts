// The database as the engine sees it: PostgreSQL on a server, PGlite (Postgres in WebAssembly) on a device.
export interface Sql {
  query<T = any>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
  /** Several statements at once, no parameters (migrations). */
  exec(text: string): Promise<void>;
}
export interface Db {
  /** Runs as the database owner: migrations, sign-in tables, bundled content. Never for a person's data. */
  admin: Sql;
  /** One transaction. */
  tx<T>(fn: (q: Sql) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  kind: "pg" | "pglite";
}

/** A transaction limited to one person's rows by row-level security (migration 002). */
export function withUser<T>(db: Db, userId: string, fn: (q: Sql) => Promise<T>): Promise<T> {
  return db.tx(async (q) => {
    await q.query("SET LOCAL ROLE somnium_app");
    await q.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    return fn(q);
  });
}

// Values come back the same way from both drivers: numbers as numbers, dates as "YYYY-MM-DD", times as ISO strings.
export const PARSERS: Record<number, (v: string) => unknown> = {
  1700: (v) => parseFloat(v), // numeric
  20: (v) => Number(v), // int8
  1082: (v) => v, // date
  1114: (v) => new Date(v + "Z").toISOString(), // timestamp
  1184: (v) => new Date(v.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00")).toISOString(), // timestamptz
};
