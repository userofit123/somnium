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

/** Read count and whole percent of `list` (read means a non-empty date; "" is an article marked unread by hand). */
export function progressOf(list: readonly Pick<Article, "id">[], read: ReadMap): { read: number; total: number; percent: number } {
  const n = list.filter((a) => !!read[a.id]).length;
  return { read: n, total: list.length, percent: list.length ? Math.round((n / list.length) * 100) : 0 };
}

/** The short reading path on Learn home, in order: recall and the journal first, then the first technique, then pitfalls. */
export const startPath: readonly string[] = [
  "basics/what-is-lucid-dreaming",
  "basics/how-common-is-it",
  "basics/your-first-week",
  "dream-signs/dream-recall",
  "techniques/journaling",
  "safety/sleep-first",
  "basics/which-technique-first",
  "techniques/reality-testing",
  "techniques/mild",
  "techniques/wbtb",
  "basics/common-mistakes-and-dry-spells",
];

/** Ids for pinned things that are not articles; articles pin by their own id. */
export const pinId = {
  lesson: (id: string) => `lesson:${id}`,
  term: (term: string) => `term:${slug(term)}`,
  faq: (question: string) => `faq:${slug(question)}`,
};

export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

/** Adds the id at the end, or removes it when already pinned. */
export function togglePin(pinned: readonly string[], id: string): string[] {
  return pinned.includes(id) ? pinned.filter((p) => p !== id) : [...pinned, id];
}
