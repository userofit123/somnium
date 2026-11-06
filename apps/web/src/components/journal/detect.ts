// The seam for "the app reads your dream" (PLAN.md §7.1, LDJ-18): elements found in the text, offered as chips in
// the editor for one tap to add. Until detection is built nothing is found; the editor already shows whatever this
// returns. It runs on the device only, on the opened text, and never sends it anywhere.
import type { Element } from "@somnium/shared";

export interface ElementSuggestion { id: string; name: string; why?: string }

export function suggestElements(_text: string, _elements: Pick<Element, "id" | "name" | "kind">[]): ElementSuggestion[] {
  return [];
}
