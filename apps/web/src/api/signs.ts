// Signs (PLAN.md §6.3, LDJ-19): everything is worked out on the device from the journal lists (api/journal.ts),
// opened here; the only writes are the ordinary ones on elements, links and dreams, sealed like every other.
// With the device copy they go into the journal on this device (offline too); on the direct path to the server.
import { shallowRef } from "vue";
import { mergePlan, parseDismissed, suggestionKey, type DreamElement, type Element, type ElementKind, type SignCategory, type SignCheck, type SignTheme } from "@somnium/shared";
import { api } from "./client";
import { invalidate } from "./live";
import type { DreamRow } from "./journal";

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
export async function confirmElement(id: string) { await api.put(`/elements/${id}`, { confirmed: true }); done(); }

export interface ElementEdit { name: string; kind: ElementKind; aliases: string | null; isDreamSign: boolean; signCategory: SignCategory | null }
/** Saving by hand is confirming too. */
export async function saveElement(id: string, e: ElementEdit) { await api.put(`/elements/${id}`, { ...e, confirmed: true }); done(); }

/**
 * Merges `from` into `into`: every dream that had `from` gets `into` (with the same source, confidence and place in the
 * text), `from`'s name and aliases become aliases of `into`, then `from` is removed (a soft delete, which takes its
 * remaining links with it). Each step is safe to repeat, so a merge cut short can simply be done again.
 */
export async function mergeElements(from: Element, into: Element, links: readonly DreamElement[]) {
  const p = mergePlan(from, into, links);
  for (const l of p.repoint) await api.post(`/dreams/${l.dreamId}/elements`, { elementId: into.id, source: l.source, confidence: l.confidence, span: l.span });
  await api.put(`/elements/${into.id}`, { aliases: p.aliases, confirmed: true });
  await api.del(`/elements/${from.id}`);
  done();
}

/**
 * Dismisses a suggestion: its dreams remember the dismissal (the editor's own list, so it isn't suggested there again)
 * and the element is removed with its links.
 */
export async function dismissElement(el: Element, links: readonly DreamElement[], dreams: readonly DreamRow[]) {
  const key = suggestionKey(el.kind, el.name ?? "");
  const ids = new Set(links.filter((l) => l.elementId === el.id).map((l) => l.dreamId));
  for (const d of dreams) {
    if (!ids.has(d.id)) continue;
    const list = parseDismissed(d.dismissed);
    if (!list.includes(key)) await api.put(`/dreams/${d.id}`, { dismissed: JSON.stringify([...list, key]) });
  }
  await api.del(`/elements/${el.id}`);
  done();
}
