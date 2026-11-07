// Typical dream themes beside the published norms (optional feature, LDJ-66; RESEARCH.md Part C §2.2, §2.4, §5.1).
// Pure: the dreams decrypted on this device, their theme elements and the theme lexicon go in, counts come out;
// nothing is kept or sent. The matcher is passed in (as in detect.ts) so this package keeps no dependency on
// @somnium/knowledge.
//
// Why the numbers are shown the way they are: the Typical Dreams Questionnaire asks whether a person has EVER had a
// theme (Nielsen et al. 2003, C13), so its percentages are lifetime shares of people. Yours is a share of written
// dreams. The two answer different questions, so the screen never sets them side by side as if they were one scale:
// your per-dream share is the bar, theirs is a sentence. What does carry over is "have you had it at all" and the
// order of the themes, which is stable from one sample to the next (Schredl et al. 2004, C14). The only per-dream
// norm in RESEARCH.md that fits a TDQ theme is Hall and Van de Castle's "dreams with at least one sexuality" (C9).
import { fold } from "./journal";
import { parseAliases, parseDismissed, suggestionKey } from "./detect";
import type { SignElement, SignLink, SignTheme } from "./signs";

/** A theme from themes.json with what the matching needs. */
export interface NormTheme extends SignTheme { prevalenceMen: number; prevalenceWomen: number; terms: readonly string[] }
/** A dream as far as this needs it: its sealed fields, opened on the device. */
export interface ThemeDream { id: string; title?: string | null; text?: string | null; dismissed?: string | null }
export type ThemeMatcher = (text: string, entries: readonly { name: string; terms: readonly string[] }[]) => readonly { name: string }[];

/** Below this many dreams a share says more about chance than about you. */
export const THEMES_MIN_DREAMS = 10;
/** "The most common themes" for the summary line: the top of the published list. */
export const THEMES_TOP = 10;

/** Hall/Van de Castle per-dream norms (RESEARCH.md C §2.2, UCSC norms page C9), keyed by TDQ theme id. */
export const THEME_PER_DREAM_NORMS: Readonly<Record<string, { total: number; men: number; women: number; what: string }>> = {
  "tdq-02-sexual-experiences": { total: 8, men: 12, women: 4, what: "dreams with any sexual content" },
};
export const THEMES_SOURCES = ["C13", "C14", "C9"] as const;

export interface ThemeRate<T extends NormTheme> {
  theme: T;
  /** published rank, 1 = most common (the paper's order, which themes.json keeps) */
  rank: number;
  /** your dreams that touch the theme */
  dreams: number;
  /** dreams / all your dreams, 0..1 */
  share: number;
  perDream?: (typeof THEME_PER_DREAM_NORMS)[string];
}
export interface ThemeRates<T extends NormTheme> {
  /** every dream in the journal */
  total: number;
  enough: boolean;
  /** all themes in the published order */
  rows: ThemeRate<T>[];
  /** themes you have had at least once */
  had: number;
  /** of the THEMES_TOP most common, how many you have had */
  topHad: number;
}

/** Folded names (published, screen and per-element aliases) to theme, shared with themeComparison in signs.ts. */
export function themesByName<T extends SignTheme>(themes: readonly T[]): Map<string, T> {
  const byName = new Map<string, T>();
  for (const t of themes) { byName.set(fold(t.name), t); if (t.displayName) byName.set(fold(t.displayName), t); }
  return byName;
}
/** The typical theme a "theme" element stands for, by its name or one of its other names. */
export function themeOfElement<T extends SignTheme>(e: SignElement, byName: ReadonlyMap<string, T>): T | undefined {
  if (e.kind !== "theme") return undefined;
  return [e.name ?? "", ...parseAliases(e.aliases)].map((n) => byName.get(fold(n.trim()))).find(Boolean);
}

/**
 * How many of your dreams touch each typical theme: a dream counts when it is linked to the theme (an element you
 * added or confirmed) or its words match the theme lexicon, unless that theme was dismissed for that dream.
 * `dreamIds` is every dream (the plain facts); `texts` the dreams whose text is open on this device.
 */
export function typicalThemeRates<T extends NormTheme>(dreamIds: readonly string[], texts: readonly ThemeDream[], elements: readonly SignElement[], links: readonly SignLink[], themes: readonly T[], match: ThemeMatcher): ThemeRates<T> {
  const ids = new Set(dreamIds);
  const hits = new Map<string, Set<string>>(themes.map((t) => [t.id, new Set<string>()]));
  const byName = themesByName(themes);
  const elementTheme = new Map<string, T>();
  for (const e of elements) { const t = themeOfElement(e, byName); if (t) elementTheme.set(e.id, t); }
  for (const l of links) {
    const t = elementTheme.get(l.elementId);
    if (t && ids.has(l.dreamId)) hits.get(t.id)!.add(l.dreamId);
  }
  // the entries are named by index so a hit maps straight back to its theme
  const entries = themes.map((t, i) => ({ name: String(i), terms: t.terms }));
  for (const d of texts) {
    if (!ids.has(d.id)) continue;
    const text = [d.title, d.text].filter(Boolean).join("\n");
    if (!text.trim()) continue;
    const dismissed = new Set(parseDismissed(d.dismissed));
    for (const h of match(text, entries)) {
      const t = themes[Number(h.name)];
      if (!t || dismissed.has(suggestionKey("theme", t.displayName ?? t.name)) || dismissed.has(suggestionKey("theme", t.name))) continue;
      hits.get(t.id)!.add(d.id);
    }
  }
  const total = ids.size;
  const rows = themes.map((theme, i) => {
    const n = hits.get(theme.id)!.size;
    const perDream = THEME_PER_DREAM_NORMS[theme.id];
    return { theme, rank: i + 1, dreams: n, share: total ? n / total : 0, ...(perDream ? { perDream } : {}) };
  });
  return {
    total, enough: total >= THEMES_MIN_DREAMS, rows,
    had: rows.filter((r) => r.dreams > 0).length,
    topHad: rows.slice(0, THEMES_TOP).filter((r) => r.dreams > 0).length,
  };
}
