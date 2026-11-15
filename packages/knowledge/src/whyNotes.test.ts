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
