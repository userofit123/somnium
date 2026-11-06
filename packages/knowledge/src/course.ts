/// <reference types="vite/client" />
// The course in Train (PLAN.md §6.4, §8.1, LDJ-24): eight lessons under content/course/<nn>-<id>.md, written from
// RESEARCH.md and cited like the Learn articles. Each lesson's body has a "## Today's practice" list (2-4 items,
// ticked into practice_log) and a "## Ready to move on" section; the rule itself is code (shared course.ts),
// keyed by the lesson id. Loaded only by Train, so the main bundle never carries it.
import { parseFrontMatter, countWords } from "./content";

/** The lessons in course order; the ids are what course_progress.lesson_id and the move-on rules use. */
export const lessonIds = ["recall", "journal-habits", "reality-checks", "mild-wbtb", "stabilise", "ssild-wild", "dream-control", "troubleshooting"] as const;
export type LessonId = (typeof lessonIds)[number];

export interface Lesson {
  id: LessonId;
  number: number;
  title: string;
  summary: string;
  reviewed: string;
  sources: string[];
  /** Today's practice, in order. A tick is stored as practice_log.item = practiceItemId(lesson, index). */
  practice: string[];
  /** Shows the sleep safety note (WBTB, WILD, SSILD). */
  safety: boolean;
  /** The body without the practice list (the Train card shows that as a checklist). */
  body: string;
  words: number;
}

export const practiceItemId = (lesson: string, index: number) => `lesson:${lesson}:${index + 1}`;

export function parseLesson(path: string, raw: string): Lesson {
  const m = /(?:^|\/)(\d{2})-([a-z0-9-]+)\.md$/.exec(path);
  if (!m) throw new Error(`${path}: expected course/<nn>-<id>.md`);
  const id = m[2] as LessonId;
  if (!lessonIds.includes(id)) throw new Error(`${path}: unknown lesson ${id}`);
  const { meta, body } = parseFrontMatter(raw);
  const need = (k: string) => { const v = meta[k]; if (typeof v !== "string" || !v) throw new Error(`${path}: front matter needs ${k}`); return v; };
  if (!Array.isArray(meta.sources)) throw new Error(`${path}: sources must be a list`);
  // split the practice list out of the body: everything from its heading to the next "## " heading
  const sec = /^## Today's practice\s*\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(body);
  if (!sec) throw new Error(`${path}: needs a "## Today's practice" section`);
  const practice = sec[1]!.split("\n").map((l) => /^- (.+)$/.exec(l.trim())?.[1]).filter((x): x is string => !!x);
  const rest = (body.slice(0, sec.index) + body.slice(sec.index + sec[0].length)).trim();
  return {
    id, number: Number(m[1]), title: need("title"), summary: need("summary"), reviewed: need("reviewed"),
    sources: meta.sources, practice, safety: meta.safety === "true", body: rest, words: countWords(rest),
  };
}

export function loadLessons(files: Record<string, string>): Lesson[] {
  return Object.entries(files).map(([p, raw]) => parseLesson(p, raw)).sort((a, b) => a.number - b.number);
}

function bundled(): Record<string, string> {
  // a direct import.meta.glob call (see content.ts); empty under plain Node
  try {
    return import.meta.glob("../content/course/*.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
  } catch {
    return {};
  }
}

export const lessons: readonly Lesson[] = loadLessons(bundled());
export const findLesson = (id: string) => lessons.find((l) => l.id === id);
