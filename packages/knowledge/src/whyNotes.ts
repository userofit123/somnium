/// <reference types="vite/client" />
// The "why this works" notes (LDJ-157): the first time someone uses a reality check, the morning capture, MILD, the
// WBTB planner, SSILD, the bedtime routine or the evening review, confirms a dream sign, gets "dreaming" from a check or
// marks a morning "No recall", one or two sentences say why the steps are what they are, with their sources as chips and a link into the Learn article that holds the evidence. One Markdown file per
// place under content/why/<id>.md, reviewed and cited like the Learn articles (whyNotes.test.ts checks every source).
// The body is plain text, no inline citations: the sources come from the front matter and show after it.
import { parseFrontMatter } from "./content";

/** The places that have a note. */
export const whyNoteIds = ["check", "capture", "mild", "wbtb", "ssild", "bedtime", "review", "sign", "dreaming", "no-recall"] as const;
export type WhyNoteId = (typeof whyNoteIds)[number];

export interface WhyNote {
  id: WhyNoteId;
  title: string;
  reviewed: string;
  text: string;
  sources: string[];
  /** The Learn article id (section/slug) behind "Read more". */
  more: string;
}

export function parseWhyNote(path: string, raw: string): WhyNote {
  const m = /(?:^|\/)([a-z-]+)\.md$/.exec(path);
  const id = m?.[1] as WhyNoteId | undefined;
  if (!id || !whyNoteIds.includes(id)) throw new Error(`${path}: expected why/<id>.md with a known id`);
  const { meta, body } = parseFrontMatter(raw);
  const need = (k: string) => { const v = meta[k]; if (typeof v !== "string" || !v) throw new Error(`${path}: front matter needs ${k}`); return v; };
  if (!Array.isArray(meta.sources) || !meta.sources.length) throw new Error(`${path}: sources must be a non-empty list`);
  const text = body.trim().replace(/\s+/g, " ");
  if (!text) throw new Error(`${path}: no text`);
  return { id, title: need("title"), reviewed: need("reviewed"), text, sources: meta.sources, more: need("more") };
}

export function loadWhyNotes(files: Record<string, string>): Map<WhyNoteId, WhyNote> {
  const out = new Map<WhyNoteId, WhyNote>();
  for (const [p, raw] of Object.entries(files)) { const n = parseWhyNote(p, raw); out.set(n.id, n); }
  return out;
}

function bundled(): Record<string, string> {
  // a direct import.meta.glob call (see content.ts); empty under plain Node
  try {
    return import.meta.glob("../content/why/*.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
  } catch {
    return {};
  }
}

export const whyNotes: ReadonlyMap<WhyNoteId, WhyNote> = loadWhyNotes(bundled());
