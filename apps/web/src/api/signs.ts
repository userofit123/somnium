// Signs (PLAN.md §6.3, LDJ-19): everything is worked out on the device from the journal lists (api/journal.ts),
// opened here; the only writes are the ordinary ones on elements, links and dreams, sealed like every other.
// With the device copy they go into the journal on this device (offline too); on the direct path to the server.
import { shallowRef } from "vue";
import { mergeMark, mergePlan, mergingInto, parseDismissed, suggestionKey, withoutMergeMark, type Dream, type DreamElement, type Element, type ElementKind, type SignCategory, type SignCheck, type SignTheme } from "@somnium/shared";
import { api, ApiError } from "./client";
import { invalidate } from "./live";
import { needsServer } from "./journal";

export type CheckRow = SignCheck & { evidence: string; sources: string[] };
export type ThemeRow = SignTheme & { prevalenceMen: number; prevalenceWomen: number };
/** The reality checks and typical themes, loaded on first use with the rest of the lexicons (as detect.ts does). */
export const signLexicons = shallowRef<{ checks: readonly CheckRow[]; themes: readonly ThemeRow[] } | null>(null);
let loading: Promise<void> | null = null;
export function loadSignLexicons(): Promise<void> {
  loading ??= import("@somnium/knowledge/lexicons").then((lex) => { signLexicons.value = { checks: lex.checks, themes: lex.themes }; }).catch(() => { loading = null; });
  return loading;
}

const done = () => invalidate(["journal", "home"]);

/** Confirms an element the app found: it stops being offered as a suggestion. */
export async function confirmElement(id: string) { await needsServer(() => api.put(`/elements/${id}`, { confirmed: true })); done(); }

export interface ElementEdit { name: string; kind: ElementKind; aliases: string | null; isDreamSign: boolean; signCategory: SignCategory | null }
/** Saving by hand is confirming too. */
export async function saveElement(id: string, e: ElementEdit) { await needsServer(() => api.put(`/elements/${id}`, { ...e, confirmed: true })); done(); }

/**
 * Merges `from` into `into`: first `from`'s sealed note is marked "merging into" `into` (shared signs.ts mergeMark), so
 * a merge cut short is seen and finished the next time Signs opens (finishMerges). Then every dream that had `from`
 * gets `into` (with the same source, confidence and place in the text); `into` takes `from`'s name and aliases as
 * aliases, its dream sign mark, its category when it has none, and its note; then `from` is removed (a soft delete,
 * which takes its remaining links with it). Each step is safe to repeat. The elements and links are read again here, so
 * a merge never works from a stale list.
 */
export async function mergeElements(fromEl: Element, intoEl: Element) {
  await needsServer(async () => {
    // both read again: a mark, category or note set meanwhile (another device, another tab) is carried over, not lost
    const [from, into] = await Promise.all([api.get<Element>(`/elements/${fromEl.id}`), api.get<Element>(`/elements/${intoEl.id}`)]);
    if (mergingInto(from.note) !== into.id) await api.put(`/elements/${from.id}`, { note: mergeMark(into.id, from.note) });
    await mergeSteps({ ...from, note: mergeMark(into.id, from.note) }, into);
  });
  done();
}

async function mergeSteps(from: Element, into: Element) {
  const links = await api.get<DreamElement[]>("/dream-elements");
  const p = mergePlan(from, into, links);
  for (const l of p.repoint) await api.post(`/dreams/${l.dreamId}/elements`, { elementId: into.id, source: l.source, confidence: l.confidence, span: l.span });
  await api.put(`/elements/${into.id}`, { aliases: p.aliases, isDreamSign: p.isDreamSign, signCategory: p.signCategory, note: p.note, confirmed: true });
  await api.del(`/elements/${from.id}`);
}

let finishing: Promise<number> | null = null;
/**
 * Finishes every merge left marked (a closed tab, a lost connection): with the one it was going into still there, the
 * rest of the steps; without it, the mark comes off and the element stays as it was. Once at a time. The number done.
 */
export function finishMerges(elements: readonly Element[]): Promise<number> {
  const marked = elements.filter((e) => mergingInto(e.note));
  if (!marked.length) return Promise.resolve(0);
  finishing ??= (async () => {
    let n = 0;
    try {
      for (const e of marked) {
        const into = elements.find((x) => x.id === mergingInto(e.note));
        if (into) await mergeSteps(e, into); else await api.put(`/elements/${e.id}`, { note: withoutMergeMark(e.note) });
        n++;
      }
    } finally { finishing = null; if (n) done(); }
    return n;
  })();
  return finishing;
}

/**
 * Dismisses a suggestion: every dream that has it remembers the dismissal (the editor's own list, so it isn't suggested
 * there again), then the element is removed with its links. Each dream is read again just before it is written, and
 * the lists are joined, so a dismissal made meanwhile on another device or in the editor is kept.
 */
export async function dismissElement(el: Element, links: readonly DreamElement[]) {
  const key = suggestionKey(el.kind, el.name ?? "");
  const ids = new Set(links.filter((l) => l.elementId === el.id).map((l) => l.dreamId));
  await needsServer(async () => {
    for (const id of ids) {
      let d: Dream;
      try { d = await api.get<Dream>(`/dreams/${id}`); } catch (e) { if (e instanceof ApiError && e.status === 404) continue; throw e; }
      const list = parseDismissed(d.dismissed);
      if (!list.includes(key)) await api.put(`/dreams/${id}`, { dismissed: JSON.stringify([...list, key]) });
    }
    await api.del(`/elements/${el.id}`);
  });
  done();
}
