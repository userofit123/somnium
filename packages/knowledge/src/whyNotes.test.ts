import { describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { readAll } from "./content";
import { loadWhyNotes, parseWhyNote, whyNoteIds } from "./whyNotes";

const kb = await readAll();
// the files on disk, read directly (whyNotes.ts ships in the web bundle and stays free of Node imports)
const dir = new URL("../content/why/", import.meta.url);
const files: Record<string, string> = {};
for (const f of await readdir(dir)) files[`why/${f}`] = await readFile(new URL(f, dir), "utf8");
const notes = loadWhyNotes(files);

// sources.md merges four reference lists, so one work can sit under two ids (Aspy 2017 is B37 and D11; LaBerge and
// Rheingold 1990 is A1, C1 and D1). A note citing both would show the same work twice: the same DOI, or the same first
// author, year and opening title words, is the same work.
function workKeys(text: string): string[] {
  const keys: string[] = [];
  const doi = /10\.\d{4,}\/[^\s)]+/.exec(text)?.[0]?.replace(/[.,;]+$/, "").toLowerCase();
  if (doi) keys.push("doi:" + doi);
  const author = /^[*\s]*([A-Za-z'-]+)/.exec(text)?.[1]?.toLowerCase();
  const m = /\((\d{4})[^)]*\)\.?\s*(.*)$/.exec(text);
  if (author && m) {
    const title = m[2]!.replace(/[^A-Za-z ]/g, " ").toLowerCase().split(/\s+/).filter(Boolean).slice(0, 4).join(" ");
    if (title) keys.push(`${author}:${m[1]}:${title}`);
  }
  return keys;
}

describe("First-time why notes", () => {
  it("has one note per place, and nothing else", () => {
    expect([...notes.keys()].sort()).toEqual([...whyNoteIds].sort());
  });

  it("cites only sources that exist", () => {
    for (const n of notes.values()) {
      for (const id of n.sources) expect(kb.sources.has(id), `${n.id} cites unknown source ${id}`).toBe(true);
      expect(new Set(n.sources).size, `${n.id} lists a source twice`).toBe(n.sources.length);
    }
  });

  it("cites each work once, not under two of its ids", () => {
    const work = (id: string) => workKeys(kb.sources.get(id)?.text ?? "");
    // the matcher itself: the known same-work pairs are found, different works are not
    for (const [a, b] of [["B37", "D11"], ["B38", "D12"], ["C1", "D1"], ["A1", "C1"]] as const) expect(work(a).some((k) => work(b).includes(k)), `${a} and ${b}`).toBe(true);
    expect(work("D11").some((k) => work("D12").includes(k))).toBe(false);
    for (const n of notes.values()) {
      const seen = new Map<string, string>();
      for (const id of n.sources) for (const k of work(id)) {
        expect(seen.get(k), `${n.id} cites one work as both ${seen.get(k)} and ${id}`).toBeUndefined();
        seen.set(k, id);
      }
    }
  });

  it("links Read more to a Learn article that exists", () => {
    const ids = new Set(kb.articles.map((a) => a.id));
    for (const n of notes.values()) expect(ids.has(n.more), `${n.id} links to missing article ${n.more}`).toBe(true);
  });

  it("stays calm and short: one or two sentences, plain dashes, no inline citations or links", () => {
    for (const n of notes.values()) {
      const sentences = n.text.split(/(?<=[.!?])\s+/).filter(Boolean);
      expect(sentences.length, `${n.id} has ${sentences.length} sentences`).toBeGreaterThanOrEqual(1);
      expect(sentences.length, `${n.id} has ${sentences.length} sentences`).toBeLessThanOrEqual(2);
      expect(n.text + n.title, `${n.id} has an em or en dash`).not.toMatch(/[–—]/);
      expect(n.text, `${n.id} has inline citations or links`).not.toMatch(/[[\]()]/);
    }
  });

  it("refuses an unknown id or a note without sources", () => {
    expect(() => parseWhyNote("why/nope.md", "---\ntitle: T\nreviewed: x\nsources: [C1]\nmore: a/b\n---\nText.\n")).toThrow();
    expect(() => parseWhyNote("why/mild.md", "---\ntitle: T\nreviewed: x\nsources: []\nmore: a/b\n---\nText.\n")).toThrow();
  });
});
