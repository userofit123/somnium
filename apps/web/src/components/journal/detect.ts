// The seam for "the app reads your dream" (PLAN.md §7.1, LDJ-18): elements found in the text, offered as chips in
// the editor for one tap to add. It runs on the device only, on the opened text, and never sends it anywhere.
// The lexicons (about 100 kB of terms) load on first use, after the editor has painted, so opening a dream is not
// slower; until they are here nothing is suggested.
import { shallowRef } from "vue";
import { detectElements, type DetectLexicons, type DetectMatchers, type OwnElement, type Suggestion } from "@somnium/shared";

export type { Suggestion };
const loaded = shallowRef<{ lexicons: DetectLexicons; match: DetectMatchers } | null>(null);
let loading: Promise<void> | null = null;

/** Starts loading the lexicons (once); `ready` turns true when they are here. */
export function loadLexicons(): Promise<void> {
  loading ??= import("@somnium/knowledge/lexicons").then((lex) => {
    loaded.value = {
      lexicons: { characters: lex.characters, places: lex.places, objects: lex.objects, actions: lex.actions, sensations: lex.sensations, emotions: lex.emotions, themes: lex.themes, signs: lex.signs },
      match: { matchLexicon: lex.matchLexicon, stem: lex.stem },
    };
  }).catch(() => { loading = null; });
  return loading;
}
export const lexiconsReady = () => !!loaded.value;

export function suggestElements(text: string, own: readonly OwnElement[], linked: readonly string[], dismissed: readonly string[]): Suggestion[] {
  const l = loaded.value;
  if (!l) return [];
  return detectElements({ text, own, linked, dismissed, lexicons: l.lexicons, match: l.match });
}
