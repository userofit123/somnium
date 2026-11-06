// PostgreSQL through node-postgres (the server).
import pg from "pg";
import { PARSERS, type Db, type Sql } from "../db";

for (const [oid, fn] of Object.entries(PARSERS)) pg.types.setTypeParser(Number(oid), fn);
// numeric[] and int8[] arrays
pg.types.setTypeParser(1231, (v: string) => (v === "{}" ? [] : v.slice(1, -1).split(",").map(Number)));

export function pgDb(connectionString: string): Db {
  const pool = new pg.Pool({ connectionString, max: 10 });
  return {
    kind: "pg",
    admin: { query: (t, p) => pool.query(t, p as unknown[]) as any, exec: async (t) => { await pool.query(t); } },
    async tx(fn) {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        const r = await fn({ query: (t, p) => c.query(t, p as unknown[]) as any, exec: async (t) => { await c.query(t); } } as Sql);
        await c.query("COMMIT");
        return r;
      } catch (e) {
        await c.query("ROLLBACK").catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    },
    close: () => pool.end(),
  };
}
