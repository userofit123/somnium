// Text from elsewhere into the journal (PLAN.md §12, LDJ-16 and LDJ-36): a Markdown or text journal split at its date
// headings, a folder of one-file-per-dream notes (the date in the file name or its front matter), and CSV rows with
// the person's own column mapping. Everything here only proposes entries; the person reviews them before anything is
// saved, and saving goes through the normal routes, so every entry is sealed on the way in.

export interface ImportedEntry { date: string; title: string; text: string; lucid?: boolean }

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const pad = (n: number) => String(n).padStart(2, "0");
function ymd(y: number, m: number, d: number): string | null {
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCMonth() === m - 1 ? `${y}-${pad(m)}-${pad(d)}` : null;
}
const monthOf = (s: string) => { const i = MONTHS.findIndex((m) => m.startsWith(s.toLowerCase().slice(0, 3))); return s.length >= 3 && i >= 0 ? i + 1 : 0; };

const DATE_RES: { re: RegExp; get: (m: RegExpMatchArray) => string | null }[] = [
  { re: /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/, get: (m) => ymd(+m[1]!, +m[2]!, +m[3]!) }, // 2026-11-07
  { re: /(\d{1,2})\.(\d{1,2})\.(\d{4})/, get: (m) => ymd(+m[3]!, +m[2]!, +m[1]!) }, // 07.11.2026
  { re: /(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,})\.?,?\s+(\d{4})/, get: (m) => (monthOf(m[2]!) ? ymd(+m[3]!, monthOf(m[2]!), +m[1]!) : null) }, // 7 November 2026
  { re: /([A-Za-z]{3,})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/, get: (m) => (monthOf(m[1]!) ? ymd(+m[3]!, monthOf(m[1]!), +m[2]!) : null) }, // November 7, 2026
];

/** The first date in a piece of text, as YYYY-MM-DD, and the text around it. */
export function findDate(s: string): { date: string; rest: string } | null {
  for (const { re, get } of DATE_RES) {
    const m = s.match(re);
    const date = m && get(m);
    if (date) return { date, rest: (s.slice(0, m!.index) + s.slice(m!.index! + m![0].length)) };
  }
  return null;
}
/** A date in a CSV cell (or anywhere): ISO, dotted, written out, or a US-style 11/07/2026 read as month first. */
export function parseLooseDate(s: string): string | null {
  const f = findDate(s);
  if (f) return f.date;
  const us = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return us ? ymd(+us[3]!, +us[1]!, +us[2]!) : null;
}

// a date line: a Markdown heading with a date in it, or a line that is nothing but a date (bold, with a weekday)
const WEEKDAY = /\b(mon|tues|wednes|thurs|fri|satur|sun)day\b,?/gi;
function dateLine(line: string): { date: string; title: string } | null {
  const heading = /^\s{0,3}#{1,6}\s+/.test(line);
  const body = line.replace(/^\s{0,3}#{1,6}\s+/, "").replace(/[*_]{1,3}/g, "").trim();
  if (!heading && body.length > 40) return null;
  const f = findDate(body);
  if (!f) return null;
  const title = f.rest.replace(WEEKDAY, "").replace(/^[\s\-:·|,.()]+|[\s\-:·|,.()]+$/g, "").trim();
  if (!heading && title) return null; // a plain line with words besides the date is part of a dream, not a heading
  return { date: f.date, title };
}

/** Front matter ("---" ... "---" at the top, as Obsidian writes it): its date and title, and the text after it. */
function frontMatter(text: string): { date?: string; title?: string; body: string } {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { body: text };
  const get = (k: string) => m[1]!.match(new RegExp(`^${k}\\s*:\\s*["']?(.+?)["']?\\s*$`, "mi"))?.[1];
  return { date: get("date") ? parseLooseDate(get("date")!) ?? undefined : undefined, title: get("title"), body: text.slice(m[0].length) };
}

const lucidWord = /(^|\W)(lucid|ld)(\W|$)/i;
function finish(e: { date: string; title: string; lines: string[] }): ImportedEntry | null {
  let lines = e.lines;
  while (lines.length && !lines[0]!.trim()) lines = lines.slice(1);
  let title = e.title;
  // a heading right under the date is the dream's title
  if (!title && lines[0] && /^\s{0,3}#{1,6}\s+/.test(lines[0])) { title = lines[0].replace(/^\s{0,3}#{1,6}\s+/, "").trim(); lines = lines.slice(1); }
  const text = lines.join("\n").trim();
  if (!text && !title) return null;
  return { date: e.date, title, text, lucid: lucidWord.test(title) || /^\s*(tags?|lucid)\s*:.*\blucid\b/im.test(text) || undefined };
}

/**
 * A journal file split into entries at its date headings. A file without any (one note per dream) is one entry,
 * dated by its front matter, its first line or its file name. undated: the words before the first date, which are
 * left out (the review shows how many characters).
 */
export function splitJournalText(text: string, fileName = ""): { entries: ImportedEntry[]; undated: number } {
  const fm = frontMatter(text.replace(/^﻿/, "").replace(/\r\n?/g, "\n"));
  const lines = fm.body.split("\n");
  const entries: ImportedEntry[] = [];
  let cur: { date: string; title: string; lines: string[] } | null = null, undated = 0;
  for (const line of lines) {
    const d = dateLine(line);
    if (d) { if (cur) { const e = finish(cur); if (e) entries.push(e); } cur = { date: d.date, title: d.title, lines: [] }; continue; }
    if (cur) cur.lines.push(line); else undated += line.trim().length;
  }
  if (cur) { const e = finish(cur); if (e) entries.push(e); }
  if (!entries.length) {
    const date = fm.date ?? findDate(fileName)?.date;
    if (date) { const e = finish({ date, title: fm.title ?? "", lines }); return { entries: e ? [e] : [], undated: 0 }; }
  } else if (fm.title && entries.length === 1 && !entries[0]!.title) entries[0]!.title = fm.title;
  return { entries, undated };
}

export interface CsvMapping { date: number; title?: number; text: number; lucid?: number }
const yes = (s: string | undefined) => !!s && /^(y|yes|true|1|x|lucid|ja|oui|si|sí)$/i.test(s.trim());

/** Guesses which column is which from the header row. */
export function guessCsvMapping(header: readonly string[]): CsvMapping {
  const find = (re: RegExp) => header.findIndex((h) => re.test(h.trim()));
  const date = find(/^(date|day|night|datum|when|created)/i);
  const title = find(/^(title|name|subject|titel)/i);
  const text = find(/^(text|dream|content|description|body|entry|notes?|traum)/i);
  const lucid = find(/lucid/i);
  return { date: Math.max(0, date), title: title >= 0 ? title : undefined, text: text >= 0 ? text : Math.min(1, header.length - 1), lucid: lucid >= 0 ? lucid : undefined };
}

/** Rows (after the header) as entries under the mapping; rows without a date or any words are left out and counted. */
export function entriesFromCsv(rows: readonly string[][], map: CsvMapping): { entries: ImportedEntry[]; skipped: number } {
  const entries: ImportedEntry[] = [];
  let skipped = 0;
  for (const r of rows.slice(1)) {
    const date = parseLooseDate(r[map.date] ?? "");
    const title = map.title != null ? (r[map.title] ?? "").trim() : "";
    const text = (r[map.text] ?? "").trim();
    if (!date || (!text && !title)) { skipped++; continue; }
    entries.push({ date, title, text, lucid: map.lucid != null ? yes(r[map.lucid]) || undefined : undefined });
  }
  return { entries, skipped };
}
