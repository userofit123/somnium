// "The app reads your dream" (PLAN.md §7.1, LDJ-18): elements suggested from the dream's text. Pure and on the device:
// the text, the person's own elements and the lexicons go in, suggestions come out, nothing is kept or sent.
// The matchers are passed in (they live with the lexicons in @somnium/knowledge) so this package keeps no
// dependency on the lexicon data and the web app can load that data lazily.
import { fold } from "./journal";
import type { ElementKind, SignCategory } from "./types";

export interface DetectEntry { readonly name: string; readonly group?: string; readonly terms: readonly string[] }
export interface DetectTheme { readonly id: string; readonly name: string; readonly displayName?: string; readonly prevalenceTotal: number; readonly terms: readonly string[] }
export interface DetectSign { readonly category: string; readonly subtype: string; readonly cues: readonly string[] }
export interface DetectLexicons {
  characters: readonly DetectEntry[]; places: readonly DetectEntry[]; objects: readonly DetectEntry[]; actions: readonly DetectEntry[];
  sensations: readonly DetectEntry[]; emotions: readonly DetectEntry[]; themes: readonly DetectTheme[]; signs: readonly DetectSign[];
}
interface Hit { name: string; term: string; start: number; end: number }
/** matchLexicon and stem from @somnium/knowledge/lexicons (dream sign cues are matched here, in the same pass). */
export interface DetectMatchers {
  matchLexicon(text: string, entries: readonly { name: string; terms: readonly string[] }[]): Hit[];
  stem(word: string): string;
}
export interface OwnElement { id: string; name: string | null; kind: ElementKind; aliases: string | null }

export type SuggestionType = "element" | "theme" | "sign";
export type SuggestionSource = "own" | "characters" | "places" | "objects" | "actions" | "sensations" | "emotions" | "themes" | "signs";
export interface Suggestion {
  /** kind and folded name: what a dismissal remembers */
  key: string;
  type: SuggestionType;
  kind: ElementKind;
  name: string;
  existingElementId?: string;
  /** [start, end) in the text, first first */
  spans: [number, number][];
  confidence: number;
  sources: SuggestionSource[];
  signCategory?: SignCategory;
}
export interface DetectInput {
  text: string;
  own: readonly OwnElement[];
  /** element ids already linked to the dream: never suggested again */
  linked?: readonly string[];
  /** suggestion keys the person dismissed for this dream */
  dismissed?: readonly string[];
  lexicons: DetectLexicons;
  match: DetectMatchers;
  max?: number;
}

/** Aliases are kept as one sealed text, comma separated. */
export const parseAliases = (s: string | null | undefined): string[] => (s ?? "").split(/[,\n]/).map((a) => a.trim()).filter(Boolean);
/** The aliases text with one more name, unless the element already answers to it. */
export function addAlias(el: { name: string | null; aliases: string | null }, alias: string): string | null {
  const a = alias.trim(), list = parseAliases(el.aliases);
  if (!a || [el.name ?? "", ...list].some((x) => fold(x) === fold(a))) return null;
  return [...list, a].join(", ");
}
export const suggestionKey = (kind: ElementKind, name: string) => `${kind}:${fold(name.trim())}`;

/** The dismissed keys kept with a dream (a sealed JSON list). */
export function parseDismissed(s: string | null | undefined): string[] {
  try { const v = JSON.parse(s ?? "[]"); return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []; } catch { return []; }
}

const LEXICON_KIND: readonly ["characters" | "places" | "objects" | "actions" | "sensations" | "emotions", ElementKind][] = [
  ["characters", "character"], ["places", "place"], ["objects", "object"], ["actions", "action"], ["sensations", "sensation"], ["emotions", "emotion"],
];
const SIGN_NAME: Readonly<Record<string, string>> = {
  thoughts: "Odd thoughts", emotions: "Out of place feeling", sensations: "Strange body sensation", perceptions: "Strange perception",
  "ego-action": "Did the impossible", "character-action": "Someone did the impossible", "object-action": "Things acting oddly",
  "ego-form": "My body was different", "character-form": "Someone looked wrong", "setting-form": "The place looked wrong", "object-form": "Things looked wrong",
  "ego-role": "I was someone else", "character-role": "Someone out of their role", "character-place": "Someone in the wrong place",
  "object-place": "Things in the wrong place", "setting-place": "Places mixed up", "setting-time": "Wrong time", situation: "Odd situation",
};
// Words that turn up in almost every dream told in English, so a hit on them alone says little.
const COMMON = new Set(["home", "house", "room", "people", "friend", "man", "woman", "car", "door", "walk", "run", "look", "see", "talk", "say",
  "go", "come", "feel", "felt", "think", "know", "want", "like", "good", "bad", "happy", "sad", "fine", "nice", "big", "small", "after", "back",
  "down", "up", "out", "time", "place", "thing", "way", "day", "night", "light", "water", "hand", "head", "eye", "face", "phone", "bed", "kid", "guy", "girl", "boy"]);

const OWN_BASE = 0.9, LEX_BASE = 0.6, THEME_BASE = 0.55, SIGN_BASE = 0.5;
const clamp = (n: number) => Math.round(Math.min(0.99, Math.max(0.05, n)) * 100) / 100;
const WORD = /[\p{L}\p{N}\p{M}]+(?:['’-][\p{L}\p{N}\p{M}]+)*/gu;
const words = (s: string) => s.match(WORD) ?? [];

/** How much one matched term says: short or very common single words say less, phrases say more. */
function termWeight(term: string, match: DetectMatchers): number {
  const w = words(term);
  if (w.length > 1) return 0.05;
  const t = w[0] ?? "";
  if (COMMON.has(t.toLowerCase()) || COMMON.has(match.stem(t))) return -0.25;
  if (t.length <= 3) return -0.15;
  return 0;
}

interface Prepared {
  type: SuggestionType; kind: ElementKind; name: string; source: SuggestionSource; signCategory?: SignCategory;
  /** for the person's own elements */
  ownId?: string;
  terms: readonly string[];
  stems: string[][];
}
const isRegex = (cue: string) => cue.length > 2 && cue.startsWith("/") && cue.endsWith("/");
const stemsOf = (terms: readonly string[], match: DetectMatchers) => terms.map((t) => words(t).map((w) => match.stem(w)));
const signCategory = (c: string) => c.replace("-", "_") as SignCategory;

// The lexicons as one list, stemmed once per lexicon set and kept: every entry of every lexicon goes through the
// matcher in a single pass, because tokenising a long dream is the costly part, not comparing stems.
const prepared = new WeakMap<object, { entries: Prepared[]; regex: { re: RegExp; p: Prepared }[] }>();
function prepare(lexicons: DetectLexicons, match: DetectMatchers) {
  const had = prepared.get(lexicons);
  if (had) return had;
  const entries: Prepared[] = [];
  for (const [lex, kind] of LEXICON_KIND) {
    for (const e of lexicons[lex]) {
      // "positive" and "negative" are groupings of the emotions, not an emotion anyone would note
      if (lex === "emotions" && e.group === "valence") continue;
      entries.push({ type: "element", kind, name: e.name, source: lex, terms: e.terms, stems: stemsOf(e.terms, match) });
    }
  }
  for (const t of lexicons.themes) entries.push({ type: "theme", kind: "theme", name: t.displayName ?? t.name, source: "themes", terms: t.terms, stems: stemsOf(t.terms, match) });
  const regex: { re: RegExp; p: Prepared }[] = [];
  for (const g of lexicons.signs) {
    const base = { type: "sign" as const, kind: "dream_sign" as const, name: SIGN_NAME[g.subtype] ?? g.subtype, source: "signs" as const, signCategory: signCategory(g.category) };
    const phrases = g.cues.filter((c) => !isRegex(c));
    entries.push({ ...base, terms: phrases, stems: stemsOf(phrases, match) });
    for (const c of g.cues.filter(isRegex)) regex.push({ re: new RegExp(c.slice(1, -1), "giu"), p: { ...base, terms: [], stems: [] } });
  }
  const out = { entries, regex };
  prepared.set(lexicons, out);
  return out;
}

// Only terms whose every word is somewhere in the text are worth handing to the matcher: most of the ~3,000
// lexicon terms are absent from any one dream.
function present(entries: readonly Prepared[], have: Set<string>): { name: string; terms: string[] }[] {
  const out: { name: string; terms: string[] }[] = [];
  entries.forEach((e, i) => {
    const terms = e.terms.filter((_, k) => e.stems[k]!.length > 0 && e.stems[k]!.every((st) => have.has(st)));
    if (terms.length) out.push({ name: String(i), terms });
  });
  return out;
}

const overlaps = (a: [number, number], b: [number, number]) => a[0] < b[1] && b[0] < a[1];

/** Suggested elements for a dream, best first. */
export function detectElements(input: DetectInput): Suggestion[] {
  const { text, own, lexicons, match } = input;
  if (!text.trim()) return [];
  const linked = new Set(input.linked ?? []), dismissed = new Set(input.dismissed ?? []);
  const have = new Set(words(text).map((w) => match.stem(w)));
  const byKey = new Map<string, Suggestion & { weight: number }>();
  // every name and alias of the person's own elements, folded, so a lexicon hit on the same name is theirs
  const ownByName = new Map<string, OwnElement>();
  for (const e of own) for (const n of [e.name ?? "", ...parseAliases(e.aliases)]) if (n.trim() && !ownByName.has(fold(n.trim()))) ownByName.set(fold(n.trim()), e);
  const linkedNames = new Set([...ownByName].filter(([, e]) => linked.has(e.id)).map(([n]) => n));

  const { entries: lexEntries, regex } = prepare(lexicons, match);
  const ownEntries: Prepared[] = own.filter((e) => e.name?.trim()).map((e) => {
    const terms = [e.name!, ...parseAliases(e.aliases)];
    return { type: e.kind === "theme" ? "theme" : e.kind === "dream_sign" ? "sign" : "element", kind: e.kind, name: e.name!, source: "own", ownId: e.id, terms, stems: stemsOf(terms, match) };
  });
  const all = [...ownEntries, ...lexEntries];
  const hits = match.matchLexicon(text, present(all, have)).map((h) => ({ p: all[Number(h.name)]!, term: h.term, span: [h.start, h.end] as [number, number] }));
  const straight = text.replace(/’/g, "'");
  for (const { re, p } of regex) {
    re.lastIndex = 0;
    for (const m of straight.matchAll(re)) if (m[0].length) hits.push({ p, term: "/", span: [m.index!, m.index! + m[0].length] });
  }

  // 1. the person's own elements and aliases: always first, with high confidence
  const ownSpans: [number, number][] = [];
  for (const { p, span } of hits) {
    if (!p.ownId) continue;
    ownSpans.push(span);
    if (linked.has(p.ownId)) continue;
    const k = `own:${p.ownId}`;
    const s = byKey.get(k) ?? { key: suggestionKey(p.kind, p.name), type: p.type, kind: p.kind, name: p.name, existingElementId: p.ownId, spans: [], confidence: 0, sources: ["own"], weight: OWN_BASE };
    s.spans.push(span);
    s.weight = OWN_BASE + Math.min(0.08, (s.spans.length - 1) * 0.03);
    byKey.set(k, s);
  }

  const add = (type: SuggestionType, kind: ElementKind, name: string, span: [number, number], weight: number, source: SuggestionSource, signCategory?: SignCategory) => {
    const folded = fold(name);
    const mine = ownByName.get(folded);
    // already linked under this name, or the person's own element took these words
    if (linkedNames.has(folded) || (mine && linked.has(mine.id))) return;
    if (type === "element" && !mine && ownSpans.some((o) => overlaps(o, span))) return;
    const k = mine ? `own:${mine.id}` : `${type}:${suggestionKey(kind, name)}`;
    let s = byKey.get(k);
    if (!s) {
      s = mine
        ? { key: suggestionKey(mine.kind, mine.name ?? name), type, kind: mine.kind, name: mine.name ?? name, existingElementId: mine.id, spans: [], confidence: 0, sources: ["own"], weight: OWN_BASE - 0.1 }
        : { key: suggestionKey(kind, name), type, kind, name: name.charAt(0).toUpperCase() + name.slice(1), spans: [], confidence: 0, sources: [], weight, ...(signCategory ? { signCategory } : {}) };
      byKey.set(k, s);
    } else if (!mine) s.weight = Math.max(s.weight, weight);
    if (!s.sources.includes(source)) s.sources.push(source);
    if (!s.spans.some((x) => x[0] === span[0] && x[1] === span[1])) s.spans.push(span);
  };

  // 2. the lexicons, merged by name: one suggestion carries every place it was found. Typical dream themes and
  // LaBerge's dream sign categories stay their own kinds of suggestion.
  const emotionSpans = hits.filter((h) => h.p.source === "emotions").map((h) => h.span);
  for (const { p, term, span } of hits) {
    if (p.ownId) continue;
    // "terrified" is fear; the sensations lexicon also has it as "afraid", which says nothing more
    if (p.source === "sensations" && words(term).length === 1 && emotionSpans.some((e) => e[0] <= span[0] && span[1] <= e[1])) continue;
    // people and places are what dreamers note most (PLAN.md §7.1), so they edge ahead of the rest
    const base = p.type === "theme" ? THEME_BASE : p.type === "sign" ? SIGN_BASE : LEX_BASE + (p.kind === "character" || p.kind === "place" ? 0.05 : 0);
    add(p.type, p.kind, p.name, span, base + (term === "/" ? 0.1 : termWeight(term, match)), p.source, p.signCategory);
  }

  const out: Suggestion[] = [];
  for (const s of byKey.values()) {
    if (dismissed.has(s.key) || (s.existingElementId && linked.has(s.existingElementId))) continue;
    s.spans.sort((a, b) => a[0] - b[0]);
    // each further mention adds a little: a word said three times is more likely what the dream was about
    const more = s.sources[0] === "own" ? 0 : Math.min(0.15, (s.spans.length - 1) * 0.05);
    const { weight, ...rest } = s;
    out.push({ ...rest, confidence: clamp(weight + more) });
  }
  const order = (s: Suggestion) => (s.sources.includes("own") ? 1 : 0);
  out.sort((a, b) => order(b) - order(a) || b.confidence - a.confidence || a.spans[0]![0] - b.spans[0]![0]);
  // the best theme and the best sign always have a place, and they are three at most each, so neither they nor the
  // people, places and things of the dream crowd the others out
  const max = input.max ?? 12, keep = new Set<Suggestion>(), per: Record<string, number> = {};
  const take = (x: Suggestion) => { if (!keep.has(x) && keep.size < max && (x.type === "element" || (per[x.type] ?? 0) < 3)) { keep.add(x); per[x.type] = (per[x.type] ?? 0) + 1; } };
  out.filter((x) => x.sources.includes("own")).forEach(take);
  for (const t of ["theme", "sign"]) { const best = out.find((x) => x.type === t); if (best) take(best); }
  out.forEach(take);
  return out.filter((x) => keep.has(x));
}
