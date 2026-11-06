// The activity log (Settings → Activity log): what changed in your data, and when. It is read from sync_log
// (migration 003), which the database writes for every change to a person's rows, so nothing has to remember to log.
// A burst of changes to one thing is one entry. Only settings exist so far; a new table adds its kind to OWN and WORDS.
// Notes about the account itself (a sign-in from a new device, migration 005's account_events) are listed in between.
// The journal's sealed fields are never named here (PLAN.md §4): entries say what kind of thing changed, not its text.
import type { Router } from "../router";
import { intOrNull, str } from "../util";

export type LogKind = "settings" | "account";
export interface LogEntry {
  kind: LogKind; action: "created" | "changed" | "deleted";
  text: string; detail: string; name: string | null; at: string; from: string; changes: number;
  /** where to open it, while it still exists */
  open: { kind: string; id: string } | null;
  /** the device whose offline copy made the change ("" = made on the server or in this app directly) */
  origin: string;
}
interface Raw { seq: number; tbl: string; pk: any; op: "upsert" | "delete"; at: string; atText: string; origin: string }
interface Group { kind: Exclude<LogKind, "account">; id: string; first: number; last: number; rows: Raw[] }

// the thing each table's rows are
const OWN: Record<string, LogKind> = { user_settings: "settings" };
// [noun, said when added, said when deleted]
const WORDS: Record<Exclude<LogKind, "account">, [string, string, string]> = { settings: ["settings", "Changed settings", "Changed settings"] };
const PAGE = 1500;
const BURST = 3 * 3600_000; // changes to one thing this close together are one entry

export function activityLogRoutes(r: Router) {
  r.get("/activity-log", async ({ q }, _p, _b, qs) => {
    const limit = intOrNull(qs.limit, 1, 100) ?? 40;
    // the cursor is the last row shown: its exact time (as the database wrote it) and its number
    const [cAt, cSeq] = str(qs.before, 80).split("|");
    const after = cAt && cSeq && Number.isFinite(Number(cSeq)) && !Number.isNaN(Date.parse(cAt));
    // account notes from the same window as the page of changes; they carry their own text
    const notes: { id: string; text: string; at: string }[] = (await q.query(
      `SELECT id, text, at FROM account_events ${after ? "WHERE at < $1::timestamptz" : ""} ORDER BY at DESC LIMIT ${PAGE}`, after ? [cAt] : [])).rows;
    const noteEntries = (since: number): LogEntry[] => notes.filter((n) => new Date(n.at).getTime() >= since).slice(0, PAGE).map((n) => ({
      kind: "account" as const, action: "changed" as const, text: n.text, detail: "", name: null, at: new Date(n.at).toISOString(), from: new Date(n.at).toISOString(), changes: 1, open: null, origin: "",
    }));
    const raw: Raw[] = (await q.query(
      `SELECT seq, tbl, pk, op, at, at::text AS at_text, origin FROM sync_log ${after ? "WHERE (at, seq) < ($1::timestamptz, $2::bigint)" : ""}
       ORDER BY at DESC, seq DESC LIMIT ${PAGE}`, after ? [cAt, Number(cSeq)] : [])).rows.map((x: any) => ({ ...x, seq: Number(x.seq), atText: x.at_text }));
    if (!raw.length) return { entries: noteEntries(-Infinity).slice(0, limit), cursor: null };

    // newest first: a row joins the open group of its thing while it is within BURST of the group's oldest row
    const groups: Group[] = [], open = new Map<string, Group>();
    for (const x of raw) {
      const kind = OWN[x.tbl] as Exclude<LogKind, "account"> | undefined;
      if (!kind) continue;
      const id = x.tbl === "user_settings" ? "me" : String(x.pk.id);
      const t = new Date(x.at).getTime(), k = kind + ":" + id;
      const g = open.get(k);
      if (g && g.first - t < BURST && g.rows[0]!.origin === x.origin) { g.rows.push(x); g.first = t; continue; }
      const ng: Group = { kind, id, first: t, last: t, rows: [x] };
      groups.push(ng); open.set(k, ng);
    }
    const page = groups.slice(0, limit);
    const entries: LogEntry[] = page.map((g) => {
      const [noun, added, deleted] = WORDS[g.kind];
      const deletedNow = g.rows[0]!.op === "delete";
      const action = deletedNow ? "deleted" : "changed";
      return {
        kind: g.kind, action, text: deletedNow ? deleted : added, detail: g.rows.length > 1 ? `${g.rows.length} changes` : "", name: null,
        at: new Date(g.last).toISOString(), from: new Date(g.first).toISOString(), changes: g.rows.length,
        open: deletedNow ? null : { kind: noun, id: g.id }, origin: g.rows[0]!.origin,
      };
    });
    const lastRow = page.at(-1)?.rows.at(-1);
    const more = groups.length > limit || raw.length === PAGE;
    // notes older than this page's last change wait for the next page (the cursor is that change's time)
    const all = [...entries, ...noteEntries(more && lastRow ? new Date(lastRow.at).getTime() : -Infinity)].sort((a, b) => b.at.localeCompare(a.at));
    return { entries: all, cursor: more && lastRow ? `${lastRow.atText}|${lastRow.seq}` : null };
  });
}
