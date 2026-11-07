// Files built on the device for export (PLAN.md §12, LDJ-36): a tiny store-only zip writer (no dependency), CSV with
// proper escaping, and the Markdown and CSV files made from an export. Pure: nothing here reads a store or sends
// anything, so the journal's text only goes where the person saves the file.
import { buildDreamMarkdown } from "./exportDream";

// ----- zip (store only) -----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry { name: string; data: Uint8Array | string; date?: Date }

/** A zip archive with every file stored (no compression): Markdown and CSV are small, and every unzip tool reads it. */
export function makeZip(entries: readonly ZipEntry[]): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [], central: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name), data = typeof e.data === "string" ? enc.encode(e.data) : e.data;
    const d = e.date ?? new Date();
    // MS-DOS time and date, local time, two-second steps
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const date = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const crc = crc32(data);
    const local = new Uint8Array(30 + name.length), lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true); // UTF-8 names
    lv.setUint16(8, 0, true); lv.setUint16(10, time, true); lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true); lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true); lv.setUint16(28, 0, true); local.set(name, 30);
    const cen = new Uint8Array(46 + name.length), cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true); cv.setUint16(12, time, true); cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true); cen.set(name, 46);
    parts.push(local, data); central.push(cen);
    offset += local.length + data.length;
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22), ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true);
  const all = [...parts, ...central, end], out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of all) { out.set(p, at); at += p.length; }
  return out;
}

// ----- CSV -----
/** One cell: quoted when it holds a comma, quote, line break or edge space; a text that a spreadsheet would run as a
 *  formula (=, +, -, @ at the start), a joined list's included, gets a leading apostrophe. Numbers stay numbers. */
export function csvCell(v: unknown): string {
  if (v == null) return "";
  let s = Array.isArray(v) ? v.join("; ") : typeof v === "object" ? JSON.stringify(v) : String(v);
  // on the final text, after a list is joined: ["=cmd()", "x"] must not start a formula either
  if (typeof v !== "number" && typeof v !== "bigint" && typeof v !== "boolean" && /^[=+\-@\t\r]/.test(s) && !/^[+-]?\d+(\.\d+)?$/.test(s)) s = "'" + s;
  return /[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const toCsv = (header: readonly string[], rows: readonly (readonly unknown[])[]): string =>
  [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";

/** RFC 4180 reading: quotes, doubled quotes, line breaks inside quotes; the delimiter (comma, semicolon or tab) is
 *  the one the first line uses most. */
export function parseCsv(text: string): string[][] {
  const t = text.replace(/^﻿/, "");
  const first = t.split(/\r?\n/, 1)[0] ?? "";
  const delim = [",", ";", "\t"].map((d) => [d, first.split(d).length] as const).sort((a, b) => b[1] - a[1])[0]![0];
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    if (q) {
      if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"' && cell === "") q = true;
    else if (c === delim) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x !== "")) rows.push(row);
  return rows;
}

// ----- an export as Markdown and CSV -----
type Row = Record<string, any>;
const live = (rows: unknown): Row[] => (Array.isArray(rows) ? rows.filter((r) => r && !r.deleted_at) : []);
const camel = (r: Row): Row => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase()), v]));
const dayOf = (v: unknown) => (v == null ? "" : String(v).slice(0, 10));

/** The export's live dreams with their night and confirmed elements, oldest first. */
function dreamsOf(tables: Record<string, unknown>) {
  const nights = new Map(live(tables.nights).map((n) => [n.id, n]));
  const elements = new Map(live(tables.elements).map((e) => [e.id, e]));
  const links = live(tables.dream_elements);
  return live(tables.dreams)
    .map((d) => ({ d, n: nights.get(d.night_id) ?? null }))
    .sort((a, b) => dayOf(a.n?.date).localeCompare(dayOf(b.n?.date)) || (a.d.position ?? 0) - (b.d.position ?? 0))
    .map(({ d, n }) => ({
      d, n,
      els: links.filter((l) => l.dream_id === d.id).map((l) => elements.get(l.element_id)).filter((e): e is Row => !!e && !!e.name)
        .map((e) => ({ kind: e.kind, name: e.name, isDreamSign: !!e.is_dream_sign })),
    }));
}

/** Each dream as its own Markdown file (names made unique: two dreams of one night get -2, -3). */
export function dreamMarkdownFiles(tables: Record<string, unknown>): { filename: string; markdown: string }[] {
  const seen = new Map<string, number>();
  return dreamsOf(tables).map(({ d, n, els }) => {
    const f = buildDreamMarkdown({ dream: camel(d) as any, night: n ? ({ ...camel(n), date: dayOf(n.date) } as any) : null, elements: els as any });
    const k = (seen.get(f.filename) ?? 0) + 1; seen.set(f.filename, k);
    return k > 1 ? { ...f, filename: f.filename.replace(/\.md$/, `-${k}.md`) } : f;
  });
}
/** Every dream in one long Markdown file, oldest first. */
export const journalMarkdown = (tables: Record<string, unknown>): string =>
  dreamMarkdownFiles(tables).map((f) => f.markdown.trim()).join("\n\n---\n\n") + "\n";

// The CSV columns. The sealed ones (the words) only when the person ticks "include dream text".
const CSV_COLUMNS = {
  dreams: {
    plain: ["date", "id", "position", "lucid", "lucidity_level", "awareness", "control", "vividness", "recall_clarity", "emotion_overall", "duration_est", "nightmare", "recurring", "false_awakening", "sleep_paralysis", "became_lucid_how", "wake_method", "favourite", "created_at", "updated_at"],
    text: ["title", "text", "lucid_trigger"],
  },
  nights: {
    plain: ["date", "id", "nap", "bedtime", "wake_time", "sleep_quality", "wbtb_used", "wbtb_wake_at", "wbtb_minutes_awake", "wbtb_mode", "caffeine_after", "alcohol", "techniques_planned", "techniques_done", "created_at", "updated_at"],
    text: ["substances", "notes", "intention"],
  },
  reality_checks: { plain: ["at", "id", "kind", "outcome", "prompted", "created_at"], text: ["note"] },
} as const;
export type CsvTable = keyof typeof CSV_COLUMNS;

export function exportCsv(tables: Record<string, unknown>, table: CsvTable, includeText: boolean): string {
  const cols = [...CSV_COLUMNS[table].plain, ...(includeText ? CSV_COLUMNS[table].text : [])];
  let rows = live(tables[table]);
  if (table === "dreams") rows = dreamsOf(tables).map(({ d, n }) => ({ ...d, date: dayOf(n?.date) }));
  else if (table === "nights") rows = [...rows].sort((a, b) => dayOf(a.date).localeCompare(dayOf(b.date))).map((r) => ({ ...r, date: dayOf(r.date) }));
  else rows = [...rows].sort((a, b) => String(a.at).localeCompare(String(b.at)));
  return toCsv(cols, rows.map((r) => cols.map((c) => r[c])));
}

// ----- backup files in a folder: which ones this app wrote -----
// Keeping the newest N deletes older backups, in folders the person shares with other things (Documents/Somnium on a
// phone, any folder on a computer): only files that carry both the name this app gives them and the format inside.
/** The name the app gives a backup: [account_]somnium-backup-YYYY-MM-DD-HH-MM.somniumbackup. */
export const BACKUP_NAME = /^(?:[\w.-]+-)?somnium-backup-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\.somniumbackup$/;
/** The start of a file this app wrote: a backup's JSON, plain or under a passphrase, begins with its format. */
export const looksLikeBackup = (head: string): boolean => /^﻿?\s*\{\s*"format"\s*:\s*"somnium-backup(?:-locked)?"/.test(head);
/** Among the names in a folder, the backups of this app (and of this account: `prefix`, "" for any) past the newest
 *  `keep`. A caller still checks each one's start (looksLikeBackup) before deleting it. */
export function backupsPastKeep(names: readonly string[], keep: number, prefix = ""): string[] {
  const own = names.filter((n) => BACKUP_NAME.test(n) && n.startsWith(prefix) && (prefix !== "" || n.startsWith("somnium-backup-")));
  // newest first by the time in the name (an account prefix doesn't change the order within one account)
  return own.sort().reverse().slice(Math.max(1, keep));
}
