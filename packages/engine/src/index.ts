// The Somnium engine: all of the app's data logic, independent of where it runs.
// The server wraps it in HTTP; on a device it runs inside the app against PGlite (PLAN.md §2.4).
import { TOPICS, type Change } from "@somnium/shared";
import type { Db } from "./db";
import { withUser } from "./db";
import { Router, type Ctx } from "./router";
import { HttpError } from "./errors";
import { migrate } from "./migrate";
import { uuidv7 } from "./ids";
import { settingsRoutes } from "./modules/settings";
import { dataRoutes } from "./modules/data";
import { syncRoutes } from "./modules/sync";
import { activityLogRoutes } from "./modules/activitylog";
import { journalRoutes } from "./modules/journal";
import { checkRoutes } from "./modules/checks";
import { practiceRoutes } from "./modules/practice";

export type { Db, Sql } from "./db";
export { withUser } from "./db";
export { HttpError } from "./errors";
export { uuidv7, isUuid } from "./ids";
export { visible } from "./util";
export { exportAll, importAll } from "./modules/data";
export * as replica from "./sync/replica";
export type { Change } from "./sync/core";
export { SEALED_COLUMNS, SEALED_SETTING_KEYS, SEALED_TABLES, isSealedColumn, isSealedSettingKey } from "./sealed";
export { sealRows, unsealRows, sealChanges, unsealChanges, needsKey, LockedError, BYTES_COLUMNS } from "./sync/sealing";
export { isJournalRoute, sealRequest, openResponse, previewImport } from "./sync/sealedApi";

export interface Request { method: string; path: string; query?: Record<string, string>; body?: unknown; userId: string }
export interface Response { status: number; body: unknown }
export type Listener = (userId: string, topics: string[]) => void;

export interface Engine {
  db: Db;
  handle(req: Request): Promise<Response>;
  /** Called after every change with the topics it touched; returns an unsubscribe function. */
  onChange(fn: Listener): () => void;
  /** Creates the single person of a local (on-device) account, or returns the one that exists. */
  ensureLocalUser(name?: string): Promise<string>;
}

/** seed: false for a device's copy of a server account (nothing is seeded yet; kept for the bundled content to come). */
export async function createEngine(db: Db, opts: { mode: "server" | "local"; now?: () => Date; seed?: boolean } = { mode: "server" }): Promise<Engine> {
  await migrate(db);
  const router = new Router();
  for (const add of [settingsRoutes, dataRoutes, syncRoutes, activityLogRoutes, journalRoutes, checkRoutes, practiceRoutes]) add(router);
  const listeners = new Set<Listener>();
  const now = opts.now ?? (() => new Date());

  return {
    db,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    async handle(req) {
      const path = req.path.replace(/^\/api/, "").split("?")[0]!;
      const m = router.match(req.method.toUpperCase(), path);
      if (!m) return { status: 404, body: { error: "Not found" } };
      const changes = new Set<Change>();
      try {
        const body = await withUser(db, req.userId, async (q) => {
          const ctx: Ctx = { q, userId: req.userId, mode: opts.mode, now, changed: (...c) => c.forEach((x) => changes.add(x)) };
          const out = await m.handler(ctx, m.params, req.body ?? {}, req.query ?? {});
          if (changes.size) await q.query("INSERT INTO events (user_id, type, payload) VALUES ($1, $2, '{}')", [req.userId, [...changes].join(",")]);
          return out;
        });
        if (changes.size) {
          const topics = [...new Set([...changes].flatMap((c) => [...TOPICS[c]]))];
          for (const fn of listeners) { try { fn(req.userId, topics); } catch { /* a listener's problem is its own */ } }
        }
        return { status: 200, body: body ?? null };
      } catch (e) {
        if (e instanceof HttpError) return { status: e.status, body: { error: e.message } };
        const msg = (e as Error).message ?? String(e);
        // a broken rule in the data (e.g. a reference to a missing row) is the caller's mistake, not a crash
        if (/violates (foreign key|check|not-null|unique)/.test(msg)) return { status: 400, body: { error: "That doesn't fit the data: " + msg.split(" on table")[0] } };
        throw e;
      }
    },
    async ensureLocalUser(name = "Me") {
      const r = (await db.admin.query("SELECT id FROM users ORDER BY created_at LIMIT 1")).rows[0];
      if (r) return r.id;
      const id = uuidv7();
      await db.admin.query("INSERT INTO users (id, username, display_name, role) VALUES ($1, 'local', $2, 'admin')", [id, name]);
      return id;
    },
  };
}
