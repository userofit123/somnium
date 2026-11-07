/// <reference types="vite/client" />
// Learn articles: Markdown files under content/<section>/<slug>.md with YAML front matter, plus
// content/sources.md, the merged reference lists from RESEARCH.md. Every factual claim in an
// article cites a source id like [B40]; the test checks that each id exists in sources.md.
//
// Two loaders: the web bundle uses Vite's import.meta.glob so the articles ship inside the app
// (offline, no network); readAll() reads the same files from disk for Node tests and tooling.

// The sections in reading order (LDJ-57): what it is, how sleep and the brain work, recall and dream signs, the
// techniques from beginner to advanced, safety, what it is good for, tools, substances, traditions, then history
// and people's accounts, with the glossary and FAQ last. Within a section the articles follow their `order`.
export const sections = [
  { id: "basics", title: "What lucid dreaming is" },
  { id: "science", title: "The science" },
  { id: "dream-signs", title: "Dream signs and dream content" },
  { id: "techniques", title: "Techniques" },
  { id: "safety", title: "Safety" },
  { id: "benefits", title: "Benefits and uses" },
  { id: "tools", title: "Tools and devices" },
  { id: "substances", title: "Substances" },
  { id: "traditions", title: "Traditions" },
  { id: "history", title: "History" },
  { id: "experiences", title: "People's experiences" },
  { id: "glossary", title: "Glossary" },
  { id: "faq", title: "FAQ" },
] as const;

export type Section = (typeof sections)[number]["id"];

export const sectionIds: readonly Section[] = sections.map((s) => s.id);

/** Technique ids in Train that an article's `tryIt` may link to. */
export const techniqueIds = [
  "mild", "wbtb", "reality-testing", "tholey-combined", "dream-signs", "ada", "prospective-memory",
  "cat", "autosuggestion", "wild", "ssild", "fild", "deild", "vild", "re-entry", "nap", "incubation",
  "meditation", "dream-yoga", "sound-cue", "journaling", "stabilisation", "control", "nightmares",
] as const;

export type TechniqueId = (typeof techniqueIds)[number];

export interface Article {
  /** `<section>/<slug>`, unique across the knowledge base. */
  id: string;
  slug: string;
  section: Section;
  title: string;
  /** Reading position within the section, from the `order` front matter (1 is read first). */
  order: number;
  summary: string;
  /** ISO date of the last editorial review. */
  reviewed: string;
  /** Source ids cited by the article, e.g. "B40". */
  sources: string[];
  tryIt?: TechniqueId;
  /** Markdown body without the front matter. */
  body: string;
  words: number;
}

export interface Source {
  id: string;
  /** Part letter: A, B, C or D. */
  part: string;
  text: string;
}

export interface Knowledge {
  articles: Article[];
  sources: Map<string, Source>;
}

/** Matches one citation group such as `[B40]` or `[A3, A4]`. */
const citationPattern = /\[([A-D]\d+[a-z]?(?:\s*,\s*[A-D]\d+[a-z]?)*)\]/g;

/** Every source id cited in a body, in order of first appearance. */
export function citationsIn(body: string): string[] {
  const seen = new Set<string>();
  for (const m of body.matchAll(citationPattern)) {
    for (const id of m[1]!.split(",")) seen.add(id.trim());
  }
  return [...seen];
}

type FrontMatter = Record<string, string | string[]>;

/** Tiny YAML subset: `key: value` lines, values either plain scalars or `[a, b, c]` lists. */
export function parseFrontMatter(raw: string): { meta: FrontMatter; body: string } {
  const text = raw.replace(/^﻿/, "");
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) throw new Error("missing front matter");
  const meta: FrontMatter = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (!kv) throw new Error(`bad front matter line: ${line}`);
    const [, key, value] = kv as unknown as [string, string, string];
    const v = value.trim();
    if (v.startsWith("[") && v.endsWith("]")) {
      const inner = v.slice(1, -1).trim();
      meta[key] = inner ? inner.split(",").map((s) => unquote(s.trim())) : [];
    } else {
      meta[key] = unquote(v);
    }
  }
  return { meta, body: text.slice(m[0].length) };
}

function unquote(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1);
  return s;
}

function scalar(meta: FrontMatter, key: string, path: string): string {
  const v = meta[key];
  if (typeof v !== "string" || !v) throw new Error(`${path}: front matter needs ${key}`);
  return v;
}

export function countWords(body: string): number {
  return body.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
}

/** Parses one article file. `path` is the file path relative to content/, e.g. "basics/what-is-lucid-dreaming.md". */
export function parseArticle(path: string, raw: string): Article {
  const rel = path.replace(/^.*?content\//, "");
  const m = /^([a-z-]+)\/([a-z0-9-]+)\.md$/.exec(rel);
  if (!m) throw new Error(`${path}: expected content/<section>/<slug>.md`);
  const [, section, slug] = m as unknown as [string, string, string];
  if (!(sectionIds as readonly string[]).includes(section)) throw new Error(`${path}: unknown section ${section}`);
  const { meta, body } = parseFrontMatter(raw);
  const declared = scalar(meta, "section", path);
  if (declared !== section) throw new Error(`${path}: section ${declared} does not match folder ${section}`);
  const sources = meta.sources;
  if (!Array.isArray(sources)) throw new Error(`${path}: sources must be a list`);
  const tryIt = meta.tryIt;
  if (tryIt !== undefined && !(techniqueIds as readonly string[]).includes(tryIt as string)) {
    throw new Error(`${path}: unknown tryIt ${String(tryIt)}`);
  }
  const order = Number(scalar(meta, "order", path));
  if (!Number.isInteger(order) || order < 1) throw new Error(`${path}: order must be a whole number from 1`);
  return {
    id: `${section}/${slug}`,
    slug,
    section: section as Section,
    title: scalar(meta, "title", path),
    order,
    summary: scalar(meta, "summary", path),
    reviewed: scalar(meta, "reviewed", path),
    sources,
    ...(tryIt !== undefined ? { tryIt: tryIt as TechniqueId } : {}),
    body: body.trim(),
    words: countWords(body),
  };
}

/** Parses sources.md: lines like `- **B40** Konkoly ...` under `## Part B` headings. */
export function parseSources(raw: string): Map<string, Source> {
  const out = new Map<string, Source>();
  for (const line of raw.split(/\r?\n/)) {
    const m = /^- \*\*([A-D])(\d+[a-z]?)\*\*\s+(.*)$/.exec(line);
    if (m) out.set(m[1]! + m[2]!, { id: m[1]! + m[2]!, part: m[1]!, text: m[3]!.trim() });
  }
  return out;
}

const sectionOrder = new Map<string, number>(sectionIds.map((id, i) => [id, i]));

/** Builds the knowledge base from a map of file path to raw Markdown. */
export function loadFromFiles(files: Record<string, string>): Knowledge {
  const articles: Article[] = [];
  let sources = new Map<string, Source>();
  for (const [path, raw] of Object.entries(files)) {
    if (/(^|\/)sources\.md$/.test(path)) sources = parseSources(raw);
    else if (path.endsWith(".md")) articles.push(parseArticle(path, raw));
  }
  articles.sort((a, b) => sectionOrder.get(a.section)! - sectionOrder.get(b.section)! || a.order - b.order || a.title.localeCompare(b.title));
  return { articles, sources };
}

function bundled(): Record<string, string> {
  // Vite replaces this call at build time with the files' contents; it must be a direct call, not
  // guarded by a typeof check, or the transform does not fire. Under plain Node the call throws
  // (import.meta.glob is undefined there) and the bundle stays empty; use readAll() instead.
  try {
    return import.meta.glob(["../content/**/*.md", "!../content/course/**"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;
  } catch {
    return {};
  }
}

const bundle = loadFromFiles(bundled());

/** All articles, in section order then by reading order. Empty outside a Vite build; use readAll() there. */
export const articles: readonly Article[] = bundle.articles;

/** Source id to reference text. Empty outside a Vite build. */
export const sources: ReadonlyMap<string, Source> = bundle.sources;

export function articlesIn(section: Section, list: readonly Article[] = articles): Article[] {
  return list.filter((a) => a.section === section);
}

export function findArticle(id: string, list: readonly Article[] = articles): Article | undefined {
  return list.find((a) => a.id === id);
}

/** Node-friendly loader: reads content/ from disk. `dir` defaults to the package's content folder. */
export async function readAll(dir?: string): Promise<Knowledge> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const url = await import("node:url");
  const root = dir ?? path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "../content");
  const files: Record<string, string> = {};
  async function walk(d: string) {
    for (const entry of await fs.readdir(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      // the course's lessons are Train's, not Learn articles (course.ts loads them)
      if (entry.isDirectory()) { if (!(d === root && entry.name === "course")) await walk(full); }
      else if (entry.name.endsWith(".md")) files[path.relative(root, full).split(path.sep).join("/")] = await fs.readFile(full, "utf8");
    }
  }
  await walk(root);
  return loadFromFiles(files);
}
