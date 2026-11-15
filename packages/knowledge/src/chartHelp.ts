/// <reference types="vite/client" />
// The "What this shows" notes behind the info button of each Progress section (LDJ-156): one Markdown file per
// section under content/progress/<id>.md, written from RESEARCH.md and cited like the Learn articles, so they are
// reviewed the same way. Each body has three parts in this order: "## What this shows" (the definitions),
// "## How to read it" (typical values from the research where there are any) and "## What to do" (one action, with a
// link into Train or Learn). Numbers the app sets in code (how many nights before a rate shows) are written as
// {PLACEHOLDERS} and filled in by the page, so the text never drifts from the code. Loaded by Progress only.
import { parseFrontMatter, citationsIn } from "./content";

/** The sections that have a note, in page order. */
export const chartHelpIds = ["lucidity", "works", "recall", "sleep", "checks", "memory-targets", "events", "themes", "day-notes", "answers"] as const;
export type ChartHelpId = (typeof chartHelpIds)[number];

/** The numbers a note may name as {NAME}; the page supplies every one. */
export const chartHelpVars = ["MIN_NIGHTS", "RECALL_RUN", "RECALL_PER_NIGHT", "RECALL_WINDOW", "RECALL_MIN_NIGHTS", "QUALITY_MIN", "SLEEP_MIN_NIGHTS", "LAG_MIN_MENTIONS", "THEMES_MIN_DREAMS"] as const;
export type ChartHelpVar = (typeof chartHelpVars)[number];

export const chartHelpParts = [
  { key: "shows", heading: "What this shows" },
  { key: "read", heading: "How to read it" },
  { key: "act", heading: "What to do" },
] as const;
export type ChartHelpPart = (typeof chartHelpParts)[number]["key"];

export interface ChartHelp {
  id: ChartHelpId;
  title: string;
  reviewed: string;
  /** Every source the note cites, from its front matter. */
  sources: string[];
  /** Each part's Markdown, placeholders still in. */
  parts: Record<ChartHelpPart, string>;
}

const placeholder = /\{([A-Z_]+)\}/g;

/** The placeholders a note uses. */
export const placeholdersIn = (text: string) => [...new Set([...text.matchAll(placeholder)].map((m) => m[1]!))];

/** Fills the placeholders; one the caller left out stays as it is, so a test can catch it. */
export const fillHelp = (text: string, vars: Partial<Record<string, string | number>>) =>
  text.replace(placeholder, (all, k: string) => (vars[k] == null ? all : String(vars[k])));

export function parseChartHelp(path: string, raw: string): ChartHelp {
  const m = /(?:^|\/)([a-z-]+)\.md$/.exec(path);
  const id = m?.[1] as ChartHelpId | undefined;
  if (!id || !chartHelpIds.includes(id)) throw new Error(`${path}: expected progress/<id>.md with a known id`);
  const { meta, body } = parseFrontMatter(raw);
  const need = (k: string) => { const v = meta[k]; if (typeof v !== "string" || !v) throw new Error(`${path}: front matter needs ${k}`); return v; };
  if (!Array.isArray(meta.sources)) throw new Error(`${path}: sources must be a list`);
  // split on the "## " headings; each of the three must be there, in order, and nothing else
  const chunks = body.split(/^## /m).slice(1).map((c) => { const nl = c.indexOf("\n"); return { heading: c.slice(0, nl).trim(), text: c.slice(nl + 1).trim() }; });
  if (chunks.map((c) => c.heading).join("|") !== chartHelpParts.map((p) => p.heading).join("|")) {
    throw new Error(`${path}: needs exactly the headings ${chartHelpParts.map((p) => p.heading).join(", ")}`);
  }
  const parts = Object.fromEntries(chartHelpParts.map((p, i) => [p.key, chunks[i]!.text])) as Record<ChartHelpPart, string>;
  return { id, title: need("title"), reviewed: need("reviewed"), sources: meta.sources, parts };
}

export function loadChartHelp(files: Record<string, string>): Map<ChartHelpId, ChartHelp> {
  const out = new Map<ChartHelpId, ChartHelp>();
  for (const [p, raw] of Object.entries(files)) { const h = parseChartHelp(p, raw); out.set(h.id, h); }
  return out;
}

/** Every citation in a note's three parts. */
export const chartHelpCitations = (h: ChartHelp) => citationsIn(Object.values(h.parts).join("\n"));

function bundled(): Record<string, string> {
  // a direct import.meta.glob call (see content.ts); empty under plain Node
  try {
    return import.meta.glob("../content/progress/*.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
  } catch {
    return {};
  }
}

export const chartHelp: ReadonlyMap<ChartHelpId, ChartHelp> = loadChartHelp(bundled());
