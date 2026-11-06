// The direct API path (PLAN.md §4.1). When the device's copy is not in use (the first copy still opening, a second
// tab, no IndexedDB or WebAssembly, a failed first copy) the app talks to the journal routes itself, so sealing has
// to happen here as well: request bodies are sealed before they leave and responses are opened when they arrive.
// Kept apart from the engine's index so the web app's main bundle can load it without the handlers and migrations.
import { SealError, isSealed } from "@somnium/shared";
import { SEALED_COLUMNS } from "../sealed";
import { uuidv7 } from "../ids";
import { LockedError, needsKey, sealRow, sealRows, unsealRow, unsealRows, type Row } from "./sealing";

export { LockedError, needsKey, uuidv7 };

/** Reads a raw answer from the server, for the two routes where it picks the row. */
export type Lookup = (path: string) => Promise<any>;

// a route's table, and any lists of another table's rows inside its answers
interface Route { re: RegExp; table: string; nested?: Record<string, string> }
const ROUTES: Route[] = [
  { re: /^\/dreams\/[^/]+\/elements(\/[^/]+)?$/, table: "dream_elements" },
  { re: /^\/dream-elements$/, table: "dream_elements" },
  { re: /^\/dreams\/[^/]+\/restore$/, table: "dreams", nested: { elements: "dream_elements" } },
  { re: /^\/dream-facts$/, table: "dreams" },
  { re: /^\/nights(\/[^/]+)?$/, table: "nights", nested: { dreams: "dreams" } },
  { re: /^\/dreams(\/[^/]+)?$/, table: "dreams", nested: { elements: "dream_elements" } },
  { re: /^\/elements(\/[^/]+)?$/, table: "elements", nested: { dreams: "dream_elements" } },
  { re: /^\/reality-checks(\/[^/]+)?$/, table: "reality_checks" },
  { re: /^\/practice(\/[^/]+)?$/, table: "practice_log" },
  { re: /^\/course(\/[^/]+)?$/, table: "course_progress" },
];
// The path as the server's router will see it: what the browser's fetch resolves (".", "..", a query, a fragment),
// then no empty segments. Otherwise "/dreams/" would reach the dreams route here unrecognised: no key check, no sealing.
const clean = (path: string) => "/" + new URL("http://x/" + path).pathname.split("/").filter(Boolean).join("/");
const routeOf = (path: string) => ROUTES.find((r) => r.re.test(clean(path)));
const isBulk = (path: string) => /^\/(import|export)$/.test(clean(path));
const camelOf = (col: string) => col.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

/** Whether a request carries or returns sealed columns, and so needs the key. */
export const isJournalRoute = (path: string): boolean => !!routeOf(path) || isBulk(path);

/** The one journal write allowed without the key: a new reality check from /check, which opens over the lock screen
 *  (LDJ-28). Its only sealed column, the note, must be absent; anything else still needs the key. */
const CHECK_FIELDS = new Set(["id", "at", "kind", "outcome", "prompted"]);
const isUnsealedCheck = (method: string, path: string, body: unknown) =>
  method === "POST" && path === "/reality-checks" && !!body && typeof body === "object" && !Array.isArray(body) && Object.keys(body).every((k) => CHECK_FIELDS.has(k));

/**
 * Whether a request may be answered while the journal key is closed: anything that is not a journal route, and the
 * unsealed check above. Every other journal request, reads above all, is refused while locked, whether it would go to
 * the server (which answers ciphertext) or to the device's own copy (which answers plaintext): the lock and /check
 * screens read nothing of the journal, and nothing else may (a reminder's dream sign, a stray query).
 */
export const allowedWithoutKey = (method: string, path: string, body?: unknown): boolean =>
  !isJournalRoute(path) || isUnsealedCheck(method.toUpperCase(), path, body);

/** The id a new row will have, or the row a write is aimed at. */
async function rowIdFor(method: string, path: string, body: Row, lookup: Lookup): Promise<string | null> {
  const parts = clean(path).split("/").filter(Boolean);
  // PUT /course/:lessonId and POST /dreams/:id/elements: the server finds the row, by its lesson or by its two ends.
  // The value has to be sealed for that same row, or it would never open again.
  if (parts[0] === "course") {
    const list: Row[] = await lookup("/course");
    return (list.find((l) => l.lessonId === decodeURIComponent(parts[1] ?? ""))?.id as string | undefined) ?? uuidv7();
  }
  if (parts[0] === "dreams" && parts[2] === "elements") {
    const dream = await lookup(`/dreams/${parts[1]}`);
    return ((dream.elements as Row[]).find((l) => l.elementId === body.elementId)?.id as string | undefined) ?? uuidv7();
  }
  // a new row keeps an id it already has; an edit is sealed for the row in its path, whatever a screen left in the body
  if (method === "POST") return typeof body.id === "string" ? body.id : uuidv7();
  return parts[1] ?? null;
}

/** A restore's preview, answered on the device: the file holds the whole journal in the clear. */
export const isImportPreview = (path: string): boolean => clean(path) === "/import/preview";
/** A file going up: sealed before it leaves. */
export const isMediaUpload = (path: string): boolean => clean(path) === "/media";

/** A file that says it is sealed is checked, not believed: anything else in its sealed columns would go out in the clear. */
function refuseUnsealedFile(tables: Record<string, unknown>) {
  const refuse = () => new SealError("This file says it is sealed, but part of it is not. Nothing was sent.");
  for (const [t, rows] of Object.entries(tables)) {
    const cols = SEALED_COLUMNS[t] ?? [];
    if (!cols.length) continue;
    if (!Array.isArray(rows)) throw refuse();
    for (const row of rows) {
      if (!row || typeof row !== "object") throw refuse();
      for (const c of cols) { const v = (row as Row)[c]; if (v != null && !isSealed(v)) throw refuse(); }
    }
  }
}

function refuseMisshapenTable(rows: unknown) {
  if (!Array.isArray(rows) || rows.some((row) => !row || typeof row !== "object"))
    throw new SealError("Part of this file isn't in the form Somnium expects. Nothing was sent.");
}

/** The body as it may leave the device: a journal row's sealed columns sealed, an import's rows sealed table by table. */
export async function sealRequest(method: string, path: string, body: unknown, key: Uint8Array, lookup: Lookup): Promise<unknown> {
  if (clean(path) === "/import") {
    const b = body as { data?: any };
    if (!b?.data?.tables) return body;
    // a server export restored as it is: already ciphertext
    if (b.data.sealed) { refuseUnsealedFile(b.data.tables); return body; }
    const tables: Record<string, unknown> = {};
    for (const [t, rows] of Object.entries(b.data.tables)) {
      // anything else would pass through the sealing untouched, and a table with sealed columns must not go out in the clear
      if ((SEALED_COLUMNS[t] ?? []).length) refuseMisshapenTable(rows);
      tables[t] = Array.isArray(rows) ? await sealRows(t, rows as Row[], key) : rows;
    }
    return { ...b, data: { ...b.data, sealed: true, tables } };
  }
  const route = routeOf(path);
  if (!route || method === "GET" || method === "DELETE" || !body || typeof body !== "object") return body;
  const given = body as Row;
  const cols = SEALED_COLUMNS[route.table] ?? [];
  // a link or a lesson with nothing to seal needs no id, so it needs no lookup either
  const writes = cols.filter((c) => given[camelOf(c)] != null && given[camelOf(c)] !== "");
  const creates = method === "POST" && route.table !== "dream_elements";
  if (!writes.length && !creates) return body;
  const id = await rowIdFor(method, path, given, lookup);
  if (!id) throw new SealError("A row without an id cannot be sealed");
  const plain: Row = { id };
  for (const c of writes) plain[c] = given[camelOf(c)];
  const sealed = await sealRow(route.table, plain, key);
  const out: Row = { ...given, id };
  for (const c of writes) out[camelOf(c)] = sealed[c];
  return out;
}

/** One row of an answer, opened: its camelCase fields are handed to unsealRow under their column names. */
async function openRow(table: string, row: Row, key: Uint8Array): Promise<Row> {
  const cols = SEALED_COLUMNS[table] ?? [];
  const asColumns: Row = { id: row.id };
  for (const c of cols) asColumns[c] = row[camelOf(c)];
  const opened = await unsealRow(table, asColumns, key);
  const out: Row = { ...row };
  for (const c of cols) if (camelOf(c) in row) out[camelOf(c)] = opened[c];
  return out;
}

/** A list's rows, opened: one that doesn't open is left out, so one bad row doesn't take the whole screen with it. */
async function openList(table: string, rows: Row[], key: Uint8Array, count: { unopened: number }): Promise<Row[]> {
  const out: Row[] = [];
  for (const r of rows) {
    try { out.push(await openRow(table, r, key)); }
    catch (e) { if (!(e instanceof SealError)) throw e; count.unopened++; }
  }
  return out;
}

/**
 * The answer as the screens may see it. An export comes back plaintext, ready to keep and to restore anywhere. A row
 * that doesn't open is left out rather than costing the whole export, and the export says how many (unopened), so
 * the person is told.
 */
export async function openResponse(path: string, data: unknown, key: Uint8Array): Promise<{ data: unknown; unopened: number }> {
  const count = { unopened: 0 };
  if (clean(path) === "/export") {
    const d = data as { sealed?: boolean; tables?: Record<string, Row[]> };
    if (!d?.sealed || !d.tables) return { data, unopened: 0 };
    const tables: Record<string, Row[]> = {};
    for (const [t, rows] of Object.entries(d.tables)) {
      const opened: Row[] = [];
      for (const r of rows) {
        try { opened.push(...(await unsealRows(t, [r], key))); }
        catch (e) { if (!(e instanceof SealError)) throw e; count.unopened++; }
      }
      tables[t] = opened;
    }
    return { data: { ...d, sealed: false, tables, ...(count.unopened ? { unopened: count.unopened } : {}) }, unopened: count.unopened };
  }
  const route = routeOf(path);
  if (!route || !data || typeof data !== "object") return { data, unopened: 0 };
  if (Array.isArray(data)) return { data: await openList(route.table, data as Row[], key, count), unopened: count.unopened };
  const row = data as Row;
  // DELETE's { ok: true }, and anything else that isn't a row
  if (typeof row.id !== "string") return { data, unopened: 0 };
  const out = await openRow(route.table, row, key);
  for (const [field, table] of Object.entries(route.nested ?? {}))
    if (Array.isArray(row[field])) out[field] = await openList(table, row[field] as Row[], key, count);
  return { data: out, unopened: count.unopened };
}

/** What a restore would bring, answered on the device: the file holds the whole journal in the clear, so it never goes to the server just to be counted. */
export function previewImport(body: unknown) {
  const d = (body as { data?: any })?.data;
  if (!d || d.app !== "somnium") return null;
  const counts = Object.fromEntries(Object.entries(d.tables ?? {}).map(([k, v]) => [k, Array.isArray(v) ? v.length : 0]));
  return { exportedAt: d.exportedAt, format: d.format, counts, from: null, to: null };
}
