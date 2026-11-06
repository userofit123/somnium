// PGlite: Postgres compiled to WebAssembly, for local accounts on a device (desktop, Android) and for tests.
// dataDir: "memory://" (tests), "idb://name" (browser / Android WebView), or a folder path (desktop).
import { PGlite } from "@electric-sql/pglite";
import { PARSERS, type Db, type Sql } from "../db";

export async function pgliteDb(dataDir = "memory://"): Promise<Db> {
  const lite = await PGlite.create(dataDir, { parsers: PARSERS as any });
  // PGlite runs one query at a time; queue transactions so they never interleave
  let chain: Promise<unknown> = Promise.resolve();
  const run = <T>(fn: () => Promise<T>): Promise<T> => {
    const p = chain.then(fn, fn);
    chain = p.catch(() => {});
    return p;
  };
  const admin: Sql = { query: (t, p) => run(() => lite.query(t, p as any[]) as any), exec: (t) => run(async () => { await lite.exec(t); }) };
  return {
    kind: "pglite",
    admin,
    tx: (fn) => run(async () => (await lite.transaction((tx) => fn({ query: (t, p) => tx.query(t, p as any[]) as any, exec: async (t) => { await tx.exec(t); } })))!),
    close: () => lite.close(),
  };
}
