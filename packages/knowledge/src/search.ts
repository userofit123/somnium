// Offline search over Learn: a small in-memory index of lines, no dependency. Titles count most, then
// summaries, then body lines; every query word must appear (as the start of a word) somewhere in the article.
import type { Article } from "./content";

export interface IndexedArticle { id: string; title: string; summary: string; lines: string[]; lower: { title: string; summary: string; lines: string[] } }
export interface SearchHit { id: string; score: number; /** the matching line, citations removed */ line: string; where: "title" | "summary" | "body" }

/** Removes Markdown marks and citations so a result line reads as plain text. */
export function plain(line: string): string {
  return line
    .replace(/\[[A-D]\d+[a-z]?(?:\s*,\s*[A-D]\d+[a-z]?)*\]/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
    .replace(/^#{1,6}\s+/, "").replace(/^>\s?/, "")
    .replace(/[*_`]/g, "").replace(/\s+([,.;:])/g, "$1").replace(/,([.;:])/g, "$1").replace(/\s+/g, " ").trim();
}

export function buildIndex(list: readonly Pick<Article, "id" | "title" | "summary" | "body">[]): IndexedArticle[] {
  return list.map((a) => {
    const lines = a.body.split(/\n/).map(plain).filter((l) => l && !/^\|?\s*:?-{2,}/.test(l));
    return { id: a.id, title: a.title, summary: a.summary, lines, lower: { title: a.title.toLowerCase(), summary: a.summary.toLowerCase(), lines: lines.map((l) => l.toLowerCase()) } };
  });
}

export function queryWords(q: string): string[] {
  return q.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

const hasWord = (text: string, w: string) => text.startsWith(w) || text.includes(" " + w) || text.includes("(" + w) || text.includes('"' + w) || text.includes("-" + w);

export function search(index: readonly IndexedArticle[], q: string, limit = 30): SearchHit[] {
  const words = queryWords(q);
  if (!words.length) return [];
  const hits: SearchHit[] = [];
  for (const a of index) {
    const l = a.lower;
    const all = l.title + " \n " + l.summary + " \n " + l.lines.join(" \n ");
    if (!words.every((w) => hasWord(all, w))) continue;
    let score = 0;
    for (const w of words) {
      if (hasWord(l.title, w)) score += 10;
      if (hasWord(l.summary, w)) score += 4;
      score += Math.min(3, l.lines.filter((x) => hasWord(x, w)).length);
    }
    // the line to show: the one holding the most query words, else the summary
    let best = -1, bestN = 0;
    l.lines.forEach((x, i) => { const n = words.filter((w) => hasWord(x, w)).length; if (n > bestN) { bestN = n; best = i; } });
    const inTitle = words.every((w) => hasWord(l.title, w));
    hits.push(best >= 0 && !inTitle
      ? { id: a.id, score, line: a.lines[best]!, where: "body" }
      : { id: a.id, score, line: a.summary, where: inTitle ? "title" : "summary" });
  }
  return hits.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, limit);
}

/** Splits a line around the query words so the screen can mark them without raw HTML. */
export function highlight(line: string, q: string): { text: string; hit: boolean }[] {
  const words = queryWords(q);
  if (!words.length) return [{ text: line, hit: false }];
  const re = new RegExp("(" + words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")", "giu");
  return line.split(re).map((text, i) => ({ text, hit: i % 2 === 1 })).filter((p) => p.text);
}

/** A window of at most `max` characters around the first match, so a long line stays readable. */
export function excerpt(line: string, q: string, max = 180): string {
  if (line.length <= max) return line;
  const w = queryWords(q)[0] ?? "";
  const at = Math.max(0, line.toLowerCase().indexOf(w));
  const from = Math.max(0, Math.min(at - 50, line.length - max));
  return (from > 0 ? "..." : "") + line.slice(from, from + max).trim() + (from + max < line.length ? "..." : "");
}
