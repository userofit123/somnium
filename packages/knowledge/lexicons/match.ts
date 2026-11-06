// Pure text matching for the lexicons. Runs on the device on sealed dream text, so it must never log or keep
// what it reads. No dependencies: the `compromise` step of PLAN.md section 7.1 sits on top of this, not inside it.

export interface MatchableEntry {
  readonly name: string;
  readonly terms: readonly string[];
  readonly group?: string;
}

export interface LexiconHit {
  /** The entry that matched. */
  name: string;
  group?: string;
  /** The lexicon term that matched, as written in the lexicon. */
  term: string;
  /** Span in the original text, so the editor can underline it. */
  start: number;
  end: number;
  /** The matched text, exactly as the person wrote it. */
  text: string;
}

interface Token {
  stem: string;
  start: number;
  end: number;
}

// Plurals that are different words: without this, "news" would match "new" and "glasses" would match "glass".
const NOT_INFLECTED = new Set(["news", "glasses", "tired", "here", "there"]);
const IRREGULAR: Readonly<Record<string, string>> = { men: "man", women: "woman" };
const HAS_VOWEL = /[aeiouy]/;
// Doubled final consonants are undone (stopped -> stop), except the ones English keeps (fall, miss, buzz).
const DOUBLED = /([^aeiouylsz])\1$/;
// One short syllable means a silent e went missing: caring -> care, so it never collides with "car".
const SHORT_SYLLABLE = /^[^aeiouy]*[aeiouy][^aeiouwxy]$/;
const LOST_E = /[vcuz]$/;

function restoreBase(stripped: string): string {
  if (DOUBLED.test(stripped)) return stripped.slice(0, -1);
  if (SHORT_SYLLABLE.test(stripped) || LOST_E.test(stripped)) return `${stripped}e`;
  return stripped;
}

function stripPlural(word: string): string {
  if (word.length >= 6 && word.endsWith("oes")) return word.slice(0, -2);
  if (/(sses|xes|ches|shes)$/.test(word) || word === "buses") return word.slice(0, -2);
  if (word.endsWith("s") && !/(ss|us|is)$/.test(word) && word.length >= 4) return word.slice(0, -1);
  return word;
}

function stripVerbEnding(word: string): string {
  if (word.endsWith("ing")) {
    const stripped = word.slice(0, -3);
    if (stripped.length >= 2 && HAS_VOWEL.test(stripped)) return restoreBase(stripped);
  }
  if (word.endsWith("ed") && !word.endsWith("eed")) {
    const stripped = word.slice(0, -2);
    if (stripped.length >= 3 && HAS_VOWEL.test(stripped)) return restoreBase(stripped);
  }
  return word;
}

/** Simple plural, -ing and -ed stripping. Both sides of a match go through this, so it only has to be consistent. */
export function stem(word: string): string {
  const lower = word.toLowerCase().replace(/'s$/, "");
  if (NOT_INFLECTED.has(lower)) return lower;
  const irregular = IRREGULAR[lower];
  if (irregular) return irregular;
  if (lower.endsWith("ied") || lower.endsWith("ies")) return `${lower.slice(0, -3)}y`;
  if (lower.endsWith("ie")) return `${lower.slice(0, -2)}y`;
  return stripVerbEnding(stripPlural(lower));
}

// Curly apostrophes come from phone keyboards. The swap keeps the length, so spans still fit the original text.
function straightenApostrophes(text: string): string {
  return text.replace(/’/g, "'");
}

function tokenise(text: string): Token[] {
  const tokens: Token[] = [];
  for (const m of straightenApostrophes(text).matchAll(/[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/gu)) {
    tokens.push({ stem: stem(m[0]), start: m.index, end: m.index + m[0].length });
  }
  return tokens;
}

/**
 * Finds every lexicon term in the text, on whole words. Within one entry the longest term wins where terms overlap;
 * different entries may share a span, because "falling" is both an action and a theme.
 */
export function matchLexicon(text: string, lexicon: readonly MatchableEntry[]): LexiconHit[] {
  const tokens = tokenise(text);
  const hits: LexiconHit[] = [];
  for (const entry of lexicon) {
    const found: LexiconHit[] = [];
    for (const term of entry.terms) {
      const stems = tokenise(term).map((t) => t.stem);
      if (stems.length === 0) continue;
      for (let i = 0; i + stems.length <= tokens.length; i++) {
        if (!stems.every((s, j) => tokens[i + j]?.stem === s)) continue;
        const start = tokens[i]!.start;
        const end = tokens[i + stems.length - 1]!.end;
        found.push({ name: entry.name, term, start, end, text: text.slice(start, end), ...(entry.group ? { group: entry.group } : {}) });
      }
    }
    found.sort((a, b) => b.end - b.start - (a.end - a.start));
    const kept: LexiconHit[] = [];
    for (const hit of found) {
      if (!kept.some((k) => hit.start < k.end && k.start < hit.end)) kept.push(hit);
    }
    hits.push(...kept);
  }
  return hits.sort((a, b) => a.start - b.start || a.end - b.end);
}

export interface MatchableSign {
  readonly category: string;
  readonly subtype: string;
  readonly cues: readonly string[];
}

export interface SignHit {
  category: string;
  subtype: string;
  cue: string;
  start: number;
  end: number;
  text: string;
}

const isRegexCue = (cue: string) => cue.length > 2 && cue.startsWith("/") && cue.endsWith("/");

/** Dream sign cues are phrases, matched like lexicon terms, or "/regex/" strings for patterns phrases cannot express. */
export function matchSigns(text: string, signs: readonly MatchableSign[]): SignHit[] {
  const hits: SignHit[] = [];
  const straight = straightenApostrophes(text);
  for (const sign of signs) {
    const phrases = sign.cues.filter((c) => !isRegexCue(c));
    for (const h of matchLexicon(text, [{ name: sign.subtype, terms: phrases }])) {
      hits.push({ category: sign.category, subtype: sign.subtype, cue: h.term, start: h.start, end: h.end, text: h.text });
    }
    for (const cue of sign.cues.filter(isRegexCue)) {
      for (const m of straight.matchAll(new RegExp(cue.slice(1, -1), "giu"))) {
        if (m[0].length === 0) continue;
        const end = m.index + m[0].length;
        hits.push({ category: sign.category, subtype: sign.subtype, cue, start: m.index, end, text: text.slice(m.index, end) });
      }
    }
  }
  return hits.sort((a, b) => a.start - b.start || a.end - b.end);
}
