// Signs (PLAN.md §6.3, §7.2, LDJ-19): element counts and trends, co-occurrence, the dream sign candidate rule and
// shortlist, suggestions to confirm, and "signs that preceded lucidity". Pure: the decrypted lists on the device go in,
// numbers come out; nothing is kept or sent. The lexicon data (reality checks, typical themes) is passed in, as in
// detect.ts, so this package keeps no dependency on @somnium/knowledge.
import { fold } from "./journal";
import { parseAliases } from "./detect";
import { daysBetween } from "./course";
import { ELEMENT_KINDS, type ElementKind, type ElementSource, type SignCategory } from "./types";

export interface SignElement {
  id: string; kind: ElementKind; name: string | null; aliases: string | null;
  isDreamSign: boolean; signCategory: SignCategory | null; confirmed: boolean;
  /** sealed; also carries the "merging into" mark while a merge is under way (mergeMark below) */
  note?: string | null;
}
export interface SignLink { dreamId: string; elementId: string; source: ElementSource; confidence?: number | null; span?: string | null }
export interface SignDream { id: string; date: string; lucid: boolean }
/** A reality check from checks.json (its categories are written with a dash: "inner-awareness"). */
export interface SignCheck { id: string; name: string; howTo: string; pairsWith: readonly string[] }
/** A typical dream theme from themes.json (Nielsen et al. 2003, RESEARCH.md C13). */
export interface SignTheme { id: string; name: string; displayName?: string; prevalenceTotal: number }

// ---------- stats ----------
export const SPARK_WEEKS = 12;
export interface ElementStat {
  elementId: string;
  /** distinct live dreams the element is in */
  dreamCount: number;
  dreamIds: string[];
  firstSeen: string | null;
  lastSeen: string | null;
  /** dreams in the last 30 days (today included) */
  recent30: number;
  /** dreams per week, oldest first; the last value is the week ending today */
  weekly: number[];
}

/** Links to dreams that are gone (or beyond the list) are left out; a dream counts once per element. */
export function elementStats(elements: readonly { id: string }[], links: readonly SignLink[], dreams: readonly SignDream[], today: string, weeks = SPARK_WEEKS): Map<string, ElementStat> {
  const byDream = new Map(dreams.map((d) => [d.id, d]));
  const out = new Map<string, ElementStat>();
  for (const e of elements) out.set(e.id, { elementId: e.id, dreamCount: 0, dreamIds: [], firstSeen: null, lastSeen: null, recent30: 0, weekly: Array(weeks).fill(0) });
  const seen = new Set<string>();
  for (const l of links) {
    const s = out.get(l.elementId), d = byDream.get(l.dreamId);
    if (!s || !d || seen.has(`${l.elementId}|${l.dreamId}`)) continue;
    seen.add(`${l.elementId}|${l.dreamId}`);
    s.dreamCount++; s.dreamIds.push(d.id);
    if (!s.lastSeen || d.date > s.lastSeen) s.lastSeen = d.date;
    if (!s.firstSeen || d.date < s.firstSeen) s.firstSeen = d.date;
    const ago = daysBetween(d.date, today);
    if (ago >= 0 && ago < 30) s.recent30++;
    const w = Math.floor(ago / 7);
    if (ago >= 0 && w < weeks) s.weekly[weeks - 1 - w]!++;
  }
  return out;
}

/** Other elements in the same dreams as this one, most shared dreams first. */
export function coOccurrence(elementId: string, links: readonly SignLink[], liveDreamIds?: ReadonlySet<string>): { elementId: string; count: number }[] {
  const mine = new Set(links.filter((l) => l.elementId === elementId && (!liveDreamIds || liveDreamIds.has(l.dreamId))).map((l) => l.dreamId));
  const n = new Map<string, Set<string>>();
  for (const l of links) {
    if (l.elementId === elementId || !mine.has(l.dreamId)) continue;
    (n.get(l.elementId) ?? n.set(l.elementId, new Set()).get(l.elementId)!).add(l.dreamId);
  }
  return [...n].map(([id, s]) => ({ elementId: id, count: s.size })).sort((a, b) => b.count - a.count || a.elementId.localeCompare(b.elementId));
}

// ---------- candidates and score (PLAN.md §7.2) ----------
/** Support: in this many dreams in all, or in SUPPORT_RECENT dreams within SUPPORT_DAYS days. */
export const SUPPORT_MIN = 3, SUPPORT_RECENT = 2, SUPPORT_DAYS = 30;
/** Sign-ish: a dream sign element, one with a LaBerge category, or one the person marked. */
export const isSignish = (e: SignElement) => e.isDreamSign || e.signCategory != null || e.kind === "dream_sign";
export const hasSignSupport = (s: ElementStat) => s.dreamCount >= SUPPORT_MIN || s.recent30 >= SUPPORT_RECENT;
/** The §7.2 rule: enough support, and sign-ish (by its category or because the person marked it). */
export const isSignCandidate = (e: SignElement, s: ElementStat) => hasSignSupport(s) && isSignish(e);

/**
 * Score = frequency × recency weight × category weight.
 * - frequency: the number of dreams the element is in.
 * - recency weight: halves for every RECENCY_HALF_LIFE days since it was last seen, never below RECENCY_FLOOR, so a sign
 *   that was common a while ago still ranks, behind the ones showing up now.
 * - category weight: CATEGORY_WEIGHT below, times MARKED_WEIGHT when the person marked it a dream sign themselves.
 * The weights are the app's own judgement, not measured values: form and action signs are the plainly "impossible or
 * improbable" ones of LaBerge's definition (RESEARCH.md C2) and the easiest to catch in the moment; context signs are
 * often ordinary things in an odd combination (C1); inner-awareness signs happen inside you and are the easiest to
 * explain away. A sign the person picked out is one they already notice, so it ranks higher.
 */
export const RECENCY_HALF_LIFE = 30, RECENCY_FLOOR = 0.1, MARKED_WEIGHT = 1.25, UNCATEGORISED_WEIGHT = 1;
export const CATEGORY_WEIGHT: Readonly<Record<SignCategory, number>> = { form: 1.2, action: 1.2, context: 1, inner_awareness: 0.9 };

export function recencyWeight(lastSeen: string | null, today: string): number {
  if (!lastSeen) return 0;
  return Math.max(RECENCY_FLOOR, 0.5 ** (Math.max(0, daysBetween(lastSeen, today)) / RECENCY_HALF_LIFE));
}
export function categoryWeight(e: SignElement): number {
  return (e.signCategory ? CATEGORY_WEIGHT[e.signCategory] : UNCATEGORISED_WEIGHT) * (e.isDreamSign ? MARKED_WEIGHT : 1);
}
export const signScore = (e: SignElement, s: ElementStat, today: string) => s.dreamCount * recencyWeight(s.lastSeen, today) * categoryWeight(e);

// ---------- frequency line ----------
export const FREQUENCY_WINDOW = 20;
export interface SignFrequency { inWindow: number; window: number; total: number; ofAll: number }
/** "in 6 of your last 20 dreams": dreams newest first by date. */
export function signFrequency(s: ElementStat, dreams: readonly SignDream[], window = FREQUENCY_WINDOW): SignFrequency {
  const newest = [...dreams].sort((a, b) => b.date.localeCompare(a.date)).slice(0, window);
  const mine = new Set(s.dreamIds);
  return { inWindow: newest.filter((d) => mine.has(d.id)).length, window: newest.length, total: dreams.length, ofAll: s.dreamCount };
}
export function frequencyText(f: SignFrequency): string {
  const dreams = (n: number) => (n === 1 ? "dream" : "dreams");
  if (f.total <= f.window) return `in ${f.ofAll} of your ${f.total} ${dreams(f.total)}`;
  if (!f.inWindow) return `in ${f.ofAll} of your ${f.total} dreams, none of your last ${f.window}`;
  return `in ${f.inWindow} of your last ${f.window} dreams`;
}

// ---------- the shortlist ----------
export const SHORTLIST_SIZE = 5;
/** What to do when you see it (LaBerge's dreamsign practice, RESEARCH.md C1, C2): notice, question, test. */
export const SIGN_ADVICE: Readonly<Record<SignCategory | "none", string>> = {
  inner_awareness: "When a thought or feeling seems out of place, stop and ask yourself whether you are dreaming, then do the check.",
  action: "When something does the impossible, or a device won't work, stop and do the check before you carry on.",
  form: "When a body, face, thing or place looks wrong, look at it again closely and do the check.",
  context: "When someone or something is where it shouldn't be, ask how you got here, then do the check.",
  none: "When you notice it, stop, ask yourself whether you are dreaming, and do the check.",
};
export const SIGN_ADVICE_SOURCES = ["C1", "C2"] as const;
/** checks.json spells categories with a dash, the database with an underscore. */
export const lexiconCategory = (c: SignCategory) => c.replace("_", "-");
/** The check that pairs with a category: the first in the list (re-reading text, LaBerge's choice, comes first). */
export function pairedCheck<C extends SignCheck>(category: SignCategory | null, checks: readonly C[]): C | null {
  if (!category) return checks[0] ?? null;
  return checks.find((c) => c.pairsWith.includes(lexiconCategory(category))) ?? checks[0] ?? null;
}

export interface ShortlistEntry<C extends SignCheck = SignCheck, E extends SignElement = SignElement> {
  element: E; stat: ElementStat; score: number; category: SignCategory | null;
  frequency: SignFrequency; advice: string; check: C | null;
}
export function signShortlist<C extends SignCheck, E extends SignElement>(elements: readonly E[], stats: ReadonlyMap<string, ElementStat>, dreams: readonly SignDream[], checks: readonly C[], today: string, size = SHORTLIST_SIZE): ShortlistEntry<C, E>[] {
  const out: ShortlistEntry<C, E>[] = [];
  for (const e of elements) {
    const s = stats.get(e.id);
    if (!s || !isSignCandidate(e, s)) continue;
    out.push({ element: e, stat: s, score: signScore(e, s, today), category: e.signCategory, frequency: signFrequency(s, dreams), advice: SIGN_ADVICE[e.signCategory ?? "none"], check: pairedCheck(e.signCategory, checks) });
  }
  return out.sort((a, b) => b.score - a.score || (b.stat.lastSeen ?? "").localeCompare(a.stat.lastSeen ?? "") || (a.element.name ?? "").localeCompare(b.element.name ?? "")).slice(0, size);
}

// ---------- lists by kind ----------
export interface KindGroup<E extends SignElement = SignElement> { kind: ElementKind; rows: { element: E; stat: ElementStat }[] }
const matches = (e: SignElement, q: string) => !q || [e.name ?? "", ...parseAliases(e.aliases)].some((x) => fold(x).includes(q));
/** Elements under their kind, most dreams first; a search matches names and aliases. Kinds with nothing are left out. */
export function elementsByKind<E extends SignElement>(elements: readonly E[], stats: ReadonlyMap<string, ElementStat>, search = ""): KindGroup<E>[] {
  const q = fold(search.trim());
  return ELEMENT_KINDS.map((kind) => ({
    kind,
    rows: elements.filter((e) => e.kind === kind && e.name && matches(e, q)).map((e) => ({ element: e, stat: stats.get(e.id)! }))
      .filter((r) => r.stat).sort((a, b) => b.stat.dreamCount - a.stat.dreamCount || (a.element.name ?? "").localeCompare(b.element.name ?? "")),
  })).filter((g) => g.rows.length);
}

// ---------- suggestions ----------
/** An element the app found in at least this many dreams before it is offered for confirming. */
export const SUGGEST_MIN_DREAMS = 2;
/**
 * Elements to confirm, merge or dismiss: not confirmed, and every link to them came from detection (or photo text), so
 * the person never added it by hand; in at least SUGGEST_MIN_DREAMS dreams. Most dreams first.
 */
export function elementSuggestions<E extends SignElement>(elements: readonly E[], links: readonly SignLink[], stats: ReadonlyMap<string, ElementStat>, min = SUGGEST_MIN_DREAMS): { element: E; stat: ElementStat }[] {
  const manual = new Set(links.filter((l) => l.source === "manual").map((l) => l.elementId));
  return elements.filter((e) => !e.confirmed && e.name && !manual.has(e.id) && (stats.get(e.id)?.dreamCount ?? 0) >= min)
    .map((e) => ({ element: e, stat: stats.get(e.id)! }))
    .sort((a, b) => b.stat.dreamCount - a.stat.dreamCount || (a.element.name ?? "").localeCompare(b.element.name ?? ""));
}

// A merge is several writes. Before the first, the merged element's (sealed) note gets a mark naming the one it goes
// into, so a merge cut short (closed tab, lost connection) is seen, shown and finished the next time Signs opens.
const MERGE_MARK = /^\[merging into ([0-9a-f-]{36})\]\n?/;
/** The element a merge under way is moving this one into, or null. */
export const mergingInto = (note: string | null | undefined): string | null => note?.match(MERGE_MARK)?.[1] ?? null;
/** The note without the mark (null when nothing is left). */
export const withoutMergeMark = (note: string | null | undefined): string | null => note?.replace(MERGE_MARK, "").trim() || null;
export const mergeMark = (intoId: string, note: string | null | undefined): string => `[merging into ${intoId}]\n${withoutMergeMark(note) ?? ""}`;

/**
 * Merging `from` into `into`: the links to move, the ones already covered (dropped), and `into`'s new aliases, sign mark
 * (either one marked), category (`into`'s, else `from`'s) and note (both, `from`'s added once).
 */
export function mergePlan<L extends SignLink>(from: SignElement, into: SignElement, links: readonly L[]): {
  repoint: L[]; drop: L[]; aliases: string | null; isDreamSign: boolean; signCategory: SignCategory | null; note: string | null;
} {
  const there = new Set(links.filter((l) => l.elementId === into.id).map((l) => l.dreamId));
  const mine = links.filter((l) => l.elementId === from.id);
  const names = [...parseAliases(into.aliases)];
  for (const a of [from.name ?? "", ...parseAliases(from.aliases)]) {
    const t = a.trim();
    if (t && ![into.name ?? "", ...names].some((x) => fold(x) === fold(t))) names.push(t);
  }
  const keep = withoutMergeMark(into.note), add = withoutMergeMark(from.note);
  const note = !add || (keep ?? "").includes(add) ? keep : keep ? `${keep}\n\n${add}` : add;
  return {
    repoint: mine.filter((l) => !there.has(l.dreamId)), drop: mine.filter((l) => there.has(l.dreamId)), aliases: names.length ? names.join(", ") : null,
    isDreamSign: into.isDreamSign || from.isDreamSign, signCategory: into.signCategory ?? from.signCategory, note,
  };
}

// ---------- lucidity ----------
export interface LucidSplit { with: { dreams: number; lucid: number }; without: { dreams: number; lucid: number } }
/** Lucid dreams among the dreams with the element, and among those without it (sample sizes included). */
export function lucidSplit(elementId: string, links: readonly SignLink[], dreams: readonly SignDream[]): LucidSplit {
  const mine = new Set(links.filter((l) => l.elementId === elementId).map((l) => l.dreamId));
  const out: LucidSplit = { with: { dreams: 0, lucid: 0 }, without: { dreams: 0, lucid: 0 } };
  for (const d of dreams) { const b = mine.has(d.id) ? out.with : out.without; b.dreams++; if (d.lucid) b.lucid++; }
  return out;
}

export const LUCID_MIN_DREAMS = 10;
export type SignsBeforeLucidity<E extends SignElement = SignElement> =
  | { enough: false; dreams: number; needed: number }
  | { enough: true; lucidDreams: number; otherDreams: number; rows: { element: E; inLucid: number; inOther: number }[] };
/**
 * Signs present in lucid dreams against non-lucid ones: plain counts, no test of significance (with a few dozen
 * dreams any p-value would mislead). Under LUCID_MIN_DREAMS dreams there is "not enough dreams yet".
 */
export function signsBeforeLucidity<E extends SignElement>(elements: readonly E[], links: readonly SignLink[], dreams: readonly SignDream[], min = LUCID_MIN_DREAMS): SignsBeforeLucidity<E> {
  if (dreams.length < min) return { enough: false, dreams: dreams.length, needed: min };
  const lucid = new Map(dreams.map((d) => [d.id, d.lucid]));
  const rows = elements.filter(isSignish).map((element) => {
    const ds = new Set(links.filter((l) => l.elementId === element.id && lucid.has(l.dreamId)).map((l) => l.dreamId));
    let inLucid = 0, inOther = 0;
    for (const d of ds) if (lucid.get(d)) inLucid++; else inOther++;
    return { element, inLucid, inOther };
  }).filter((r) => r.inLucid + r.inOther > 0).sort((a, b) => b.inLucid - a.inLucid || a.inOther - b.inOther || (a.element.name ?? "").localeCompare(b.element.name ?? ""));
  const lucidDreams = dreams.filter((d) => d.lucid).length;
  return { enough: true, lucidDreams, otherDreams: dreams.length - lucidDreams, rows };
}

// ---------- typical themes ----------
/**
 * The typical themes (kind "theme" elements matching a themes.json entry by its name, screen name or an alias) with the
 * number of your dreams that had each, beside the share of students who said they had ever dreamed it. The two measure
 * different things: yours is a count of written dreams, theirs a lifetime "ever had" percentage.
 */
export function themeComparison<T extends SignTheme, E extends SignElement>(elements: readonly E[], stats: ReadonlyMap<string, ElementStat>, themes: readonly T[]): { theme: T; element: E; yourDreams: number }[] {
  const byName = new Map<string, T>();
  for (const t of themes) { byName.set(fold(t.name), t); if (t.displayName) byName.set(fold(t.displayName), t); }
  const out = new Map<string, { theme: T; element: E; yourDreams: number }>();
  for (const e of elements) {
    if (e.kind !== "theme") continue;
    const t = [e.name ?? "", ...parseAliases(e.aliases)].map((n) => byName.get(fold(n.trim()))).find(Boolean);
    const n = stats.get(e.id)?.dreamCount ?? 0;
    if (!t || !n) continue;
    const cur = out.get(t.id);
    if (!cur || n > cur.yourDreams) out.set(t.id, { theme: t, element: e, yourDreams: n });
  }
  return [...out.values()].sort((a, b) => b.yourDreams - a.yourDreams || b.theme.prevalenceTotal - a.theme.prevalenceTotal);
}
