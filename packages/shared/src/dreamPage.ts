// The dream page's pure parts (PLAN.md §6.2, LDJ-15): where the elements sit in the text, and the dreams that share them.
import { fold } from "./journal";
import { parseAliases } from "./detect";

export interface PageElement { id: string; name: string | null; aliases: string | null }
export interface PageLink { elementId: string; span: string | null }
export interface PageSuggestion { key: string; spans: readonly (readonly [number, number])[] }
export type Segment = { text: string; kind: "plain" } | { text: string; kind: "linked"; elementId: string } | { text: string; kind: "suggested"; key: string };

/** A stored span (a JSON list of [start, end)), or nothing for a missing or damaged one. */
export function parseSpans(span: string | null | undefined, length: number): [number, number][] {
  if (!span) return [];
  try {
    const v = JSON.parse(span);
    if (!Array.isArray(v)) return [];
    return v.filter((p): p is [number, number] => Array.isArray(p) && Number.isInteger(p[0]) && Number.isInteger(p[1]) && p[0] >= 0 && p[1] > p[0] && p[1] <= length);
  } catch { return []; }
}

const stem4 = (w: string) => fold(w).replace(/[^\p{L}\p{N}]/gu, "").slice(0, 4);
const wordsOf = (s: string) => s.split(/\s+/).map(stem4).filter((w) => w.length >= 3);
/** Whether the words at a span could be this element: the name or an alias, or a form of one (mother, mothers). */
function stillIs(text: string, [a, b]: [number, number], names: readonly string[]): boolean {
  const there = wordsOf(text.slice(a, b));
  return there.length > 0 && names.some((n) => wordsOf(n).some((w) => there.includes(w)));
}

/** Every place a name or alias stands in the text as a whole word, for a span that is missing or no longer fits. */
function findNames(text: string, names: readonly string[]): [number, number][] {
  const out: [number, number][] = [];
  for (const n of names) {
    const t = n.trim(); if (t.length < 2) continue;
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "giu");
    for (const m of text.matchAll(re)) out.push([m.index!, m.index! + m[0].length]);
  }
  return out;
}

/**
 * The text cut into pieces: plain, an underlined confirmed element, or a suggestion not yet confirmed. A confirmed
 * element sits at its stored spans when the words there still fit; otherwise (no span, or the text was edited since)
 * its name or alias is looked for in the text, once. Suggestions never cover a confirmed element.
 */
export function dreamSegments(text: string, elements: readonly PageElement[], links: readonly PageLink[], suggestions: readonly PageSuggestion[] = []): Segment[] {
  type R = { a: number; b: number; seg: Segment };
  const ranges: R[] = [];
  const free = (a: number, b: number) => !ranges.some((r) => a < r.b && r.a < b);
  for (const l of links) {
    const el = elements.find((e) => e.id === l.elementId);
    if (!el?.name) continue;
    const names = [el.name, ...parseAliases(el.aliases)];
    let spans = parseSpans(l.span, text.length).filter((s) => stillIs(text, s, names));
    if (!spans.length) { const f = findNames(text, names).sort((x, y) => x[0] - y[0]); spans = f.slice(0, 1); }
    for (const [a, b] of spans) if (free(a, b)) ranges.push({ a, b, seg: { text: text.slice(a, b), kind: "linked", elementId: el.id } });
  }
  for (const s of suggestions) for (const [a, b] of s.spans.slice(0, 1)) if (b <= text.length && free(a, b)) ranges.push({ a, b, seg: { text: text.slice(a, b), kind: "suggested", key: s.key } });
  ranges.sort((x, y) => x.a - y.a);
  const out: Segment[] = [];
  let at = 0;
  for (const r of ranges) {
    if (r.a > at) out.push({ text: text.slice(at, r.a), kind: "plain" });
    out.push(r.seg); at = r.b;
  }
  if (at < text.length) out.push({ text: text.slice(at), kind: "plain" });
  return out;
}

export interface RelatedDream { id: string; shared: number; elementIds: string[]; date: string }
/**
 * Other dreams that share at least 2 elements with this one, or a dream sign, most shared first (newer first when
 * equal), at most `limit`.
 */
export function relatedDreams(dreamId: string, links: readonly { dreamId: string; elementId: string }[], signIds: ReadonlySet<string>, dateOf: (id: string) => string | undefined, limit = 5): RelatedDream[] {
  const mine = new Set(links.filter((l) => l.dreamId === dreamId).map((l) => l.elementId));
  if (!mine.size) return [];
  const by = new Map<string, Set<string>>();
  for (const l of links) {
    if (l.dreamId === dreamId || !mine.has(l.elementId) || dateOf(l.dreamId) === undefined) continue;
    const s = by.get(l.dreamId) ?? new Set<string>(); s.add(l.elementId); by.set(l.dreamId, s);
  }
  return [...by].map(([id, s]) => ({ id, shared: s.size, elementIds: [...s], date: dateOf(id)! }))
    .filter((r) => r.shared >= 2 || r.elementIds.some((e) => signIds.has(e)))
    .sort((a, b) => b.shared - a.shared || (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id < b.id ? -1 : 1))
    .slice(0, limit);
}


