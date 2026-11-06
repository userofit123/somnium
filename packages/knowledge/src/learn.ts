// Pure Learn helpers: neighbours within a section, glossary and FAQ extraction, reading progress.
import type { Article } from "./content";
import { parseMarkdown, inlineText, type Block, type Inline } from "./markdown";

export function neighbours(list: readonly Article[], id: string): { prev?: Article; next?: Article } {
  const a = list.find((x) => x.id === id);
  if (!a) return {};
  const inSection = list.filter((x) => x.section === a.section);
  const i = inSection.findIndex((x) => x.id === id);
  return { prev: inSection[i - 1], next: inSection[i + 1] };
}

export interface GlossaryTerm { term: string; letter: string; definition: Inline[] }

/** Terms from the glossary article's bullets: `- Term (gloss): definition`. Sorted alphabetically. */
export function glossaryTerms(body: string): GlossaryTerm[] {
  const out: GlossaryTerm[] = [];
  for (const b of parseMarkdown(body)) {
    if (b.t !== "ul") continue;
    for (const item of b.items) {
      const text = inlineText(item);
      let depth = 0, cut = -1;
      for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === "(") depth++; else if (c === ")") depth--;
        else if (c === ":" && depth === 0) { cut = i; break; }
      }
      if (cut < 1) continue;
      const term = text.slice(0, cut).trim();
      // keep the inline nodes after the first colon so citations stay tappable
      const rest = dropPrefix(item, cut + 1);
      out.push({ term, letter: /^[A-Za-z]/.test(term) ? term[0]!.toUpperCase() : "#", definition: rest });
    }
  }
  return out.sort((a, b) => a.term.localeCompare(b.term, "en", { sensitivity: "base" }));
}

function dropPrefix(nodes: Inline[], chars: number): Inline[] {
  const out: Inline[] = [];
  let left = chars;
  for (const n of nodes) {
    if (left <= 0) { out.push(n); continue; }
    const len = inlineText([n]).length;
    if (len <= left) { left -= len; continue; }
    if (n.t === "text") { out.push({ t: "text", text: n.text.slice(left).replace(/^\s+/, "") }); left = 0; }
    else { out.push(n); left = 0; }
  }
  return out;
}

export interface FaqItem { question: string; answer: Block[] }

/** Questions are the `##` headings of the FAQ article; the blocks up to the next heading are the answer. */
export function faqItems(body: string): FaqItem[] {
  const out: FaqItem[] = [];
  for (const b of parseMarkdown(body)) {
    if (b.t === "heading" && b.level === 2) out.push({ question: inlineText(b.children), answer: [] });
    else out.at(-1)?.answer.push(b);
  }
  return out;
}

/** Reading progress: article id to the ISO date it was finished. */
export type ReadMap = Record<string, string>;

export function markRead(read: ReadMap, id: string, date: string): ReadMap {
  return read[id] ? read : { ...read, [id]: date };
}

/** The article to offer under "Continue reading": the first unread one after the most recently read, else the first unread. */
export function continueReading(list: readonly Article[], read: ReadMap, opened?: string): Article | undefined {
  if (opened) {
    const i = list.findIndex((a) => a.id === opened);
    const next = list.slice(i + 1).find((a) => !read[a.id]);
    if (i >= 0 && !read[opened]) return list[i];
    if (next) return next;
  }
  return list.find((a) => !read[a.id]);
}
