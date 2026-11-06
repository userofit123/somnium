// Typed loader for the bundled lexicons. Sources and licence: sources.md in this folder.
import actionsData from "./actions.json";
import charactersData from "./characters.json";
import checksData from "./checks.json";
import emotionsData from "./emotions.json";
import objectsData from "./objects.json";
import placesData from "./places.json";
import sensationsData from "./sensations.json";
import signsData from "./signs.json";
import themesData from "./themes.json";

export { matchLexicon, matchSigns, stem } from "./match";
export type { LexiconHit, MatchableEntry, MatchableSign, SignHit } from "./match";

export interface LexiconEntry {
  name: string;
  group: string;
  terms: string[];
}
export type Lexicon = readonly LexiconEntry[];

export type Valence = "positive" | "negative" | "neutral";
export interface EmotionEntry extends LexiconEntry {
  group: "basic" | "valence";
  valence: Valence;
}

/** Typical dream theme from the 55-item Typical Dreams Questionnaire. Prevalence is percent, lifetime. */
export interface DreamTheme {
  id: string;
  name: string;
  prevalenceTotal: number;
  prevalenceMen: number;
  prevalenceWomen: number;
  /** Softer wording for screens. `name` stays as published so it still matches the paper. */
  displayName?: string;
  terms: string[];
}

export type SignCategory = "inner-awareness" | "action" | "form" | "context";
export interface DreamSign {
  category: SignCategory;
  subtype: string;
  description: string;
  /** LaBerge's own example, quoted from the Dreamsign Inventory. */
  example: string;
  /** Phrases, or "/regex/" strings. Use matchSigns, which understands both. */
  cues: string[];
}

export interface RealityCheck {
  id: string;
  name: string;
  howTo: string;
  pairsWith: SignCategory[];
  evidence: string;
  /** RESEARCH.md references: "C13" is number 13 in the Part C list; "C§7" is Part C section 7, for claims with no numbered reference; "B37" and "B§3.12" are the same for Part B. */
  sources: string[];
}

export const characters: Lexicon = charactersData;
export const places: Lexicon = placesData;
export const objects: Lexicon = objectsData;
export const actions: Lexicon = actionsData;
export const sensations: Lexicon = sensationsData;
export const emotions = emotionsData as readonly EmotionEntry[];
export const themes: readonly DreamTheme[] = themesData;
export const signs = signsData as readonly DreamSign[];
export const checks = checksData as readonly RealityCheck[];
