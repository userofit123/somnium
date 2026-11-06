// The server's side of offline use (see sync/): a device's first full copy, the changes since its last visit,
// and the changes it made while away. Last change wins, row by row.
import type { Router } from "../router";
import type { Sql } from "../db";
import { bad } from "../errors";
import { str } from "../util";
import { SYNCED_BY_NAME } from "../sync/tables";
import { refusePlain } from "./rows";
import { readRows, allRows, applyChanges, latestPerRow, keyOf, overrule, DELETES_WIN, type Change } from "../sync/core";

const PAGE = 5000;

export function syncRoutes(r: Router) {
  r.get("/sync/snapshot", async ({ q, userId }) => {
    // the position first: anything changed while the rows are read is simply sent again on the next pull
    const cursor = Number((await q.query("SELECT coalesce(max(seq), 0) AS s FROM sync_log")).rows[0].s);
    const user = (await q.query("SELECT id, username, display_name, email, role FROM users WHERE id = $1", [userId])).rows[0];
    return { cursor, user, tables: await allRows(q) };
  });

  r.get("/sync/pull", async ({ q }, _p, _b, qs) => {
    const since = Number(qs.since) || 0, device = str(qs.device, 80);
    const page = (await q.query("SELECT seq, tbl, pk, op, at, origin FROM sync_log WHERE seq > $1 ORDER BY seq LIMIT $2", [since, PAGE])).rows;
    const cursor = page.length ? Number(page.at(-1).seq) : since;
    // a device already has its own changes
    const latest = latestPerRow(page as any[]).filter((e: any) => e.origin !== device);
    const rows = await readRows(q, latest.filter((e: any) => e.op === "upsert"));
    const changes: Change[] = latest.map((e: any) => {
      const row = e.op === "upsert" ? rows.get(keyOf(e.tbl, e.pk)) ?? null : null;
      return { tbl: e.tbl, pk: e.pk, op: row ? "upsert" : "delete", at: e.at, row };
    });
    return { cursor, more: page.length === PAGE, changes };
  });

  r.post("/sync/push", async (ctx, _p, b) => {
    const device = str(b.device, 80);
    if (!device) throw bad("Which device is this?");
    const list: Change[] = (Array.isArray(b.changes) ? b.changes : []).slice(0, 1000).filter((c: any) =>
      c && SYNCED_BY_NAME.has(c.tbl) && (c.op === "upsert" || c.op === "delete") && c.pk && typeof c.pk === "object" && !Number.isNaN(Date.parse(c.at)));
    // before anything is written: a device seals everything it sends, so plaintext here is never a real change
    if (ctx.mode === "server") for (const c of list) if (c.row) refusePlain(c.tbl, c.row);
    // last change wins: a newer change from somewhere else beats this one, and the device gets that one instead.
    // Except where overrule() decides first (deletions in DELETES_WIN tables are final).
    const accepted: Change[] = [], rejected: Change[] = [];
    const here = await readRows(ctx.q, list.filter((c) => DELETES_WIN.has(c.tbl))); // the only rows the rules look at
    for (const c of list) {
      const last = (await ctx.q.query("SELECT at, origin, op FROM sync_log WHERE tbl = $1 AND pk = $2::jsonb ORDER BY seq DESC LIMIT 1", [c.tbl, JSON.stringify(c.pk)])).rows[0];
      const o = overrule(c, { row: here.get(keyOf(c.tbl, c.pk)) ?? null, lastOp: last?.op });
      const wins = o ?? !(last && last.origin !== device && new Date(last.at) > new Date(c.at));
      (wins ? accepted : rejected).push(c);
    }
    const { applied, failed, kept } = await applyChanges(ctx.q, ctx.userId, accepted, { origin: device });
    rejected.push(...kept);
    const now = await readRows(ctx.q, rejected);
    const back: Change[] = rejected.map((c) => {
      const row = now.get(keyOf(c.tbl, c.pk)) ?? null;
      return { tbl: c.tbl, pk: c.pk, op: row ? "upsert" : "delete", at: new Date().toISOString(), row };
    });
    if (applied) ctx.changed("everything");
    return { applied, rejected: back, failed: failed.map((f) => ({ tbl: f.change.tbl, pk: f.change.pk, error: f.error.slice(0, 200) })) };
  });
}
