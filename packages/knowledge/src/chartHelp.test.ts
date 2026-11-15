import { describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { readAll } from "./content";
import { chartHelpCitations, chartHelpIds, chartHelpVars, fillHelp, loadChartHelp, parseChartHelp, placeholdersIn } from "./chartHelp";

const kb = await readAll();
// the files on disk, read directly (chartHelp.ts ships in the web bundle and stays free of Node imports)
const dir = new URL("../content/progress/", import.meta.url);
const files: Record<string, string> = {};
for (const f of await readdir(dir)) files[`progress/${f}`] = await readFile(new URL(f, dir), "utf8");
const help = loadChartHelp(files);

describe("Progress chart notes", () => {
  it("has one note per section, and nothing else", () => {
    expect([...help.keys()].sort()).toEqual([...chartHelpIds].sort());
  });

  it("cites only sources that exist, lists them all, and cites something in each note", () => {
    for (const h of help.values()) {
      const cited = chartHelpCitations(h);
      expect(cited.length, `${h.id} cites nothing`).toBeGreaterThan(0);
      for (const id of cited) {
        expect(kb.sources.has(id), `${h.id} cites unknown source ${id}`).toBe(true);
        expect(h.sources, `${h.id} cites ${id} but does not list it`).toContain(id);
      }
      for (const id of h.sources) expect(cited, `${h.id} lists ${id} but never cites it`).toContain(id);
    }
  });

  it("gives every part some text, uses only plain dashes and known placeholders, and links into the app", () => {
    for (const h of help.values()) {
      for (const [k, t] of Object.entries(h.parts)) {
        expect(t.length, `${h.id} ${k} is empty`).toBeGreaterThan(0);
        expect(t, `${h.id} ${k} has an em or en dash`).not.toMatch(/[–—]/);
        for (const v of placeholdersIn(t)) expect(chartHelpVars as readonly string[], `${h.id} uses {${v}}`).toContain(v);
      }
      // "What to do" points somewhere to do it: Train, Learn or another screen
      expect(h.parts.act, `${h.id} has no link in What to do`).toMatch(/\]\(\/[a-z]/);
    }
  });

  it("links only to Learn articles that exist", () => {
    const ids = new Set(kb.articles.map((a) => a.id));
    for (const h of help.values()) {
      for (const m of Object.values(h.parts).join("\n").matchAll(/\]\(\/learn\/([a-z-]+\/[a-z0-9-]+)\)/g)) {
        expect(ids.has(m[1]!), `${h.id} links to missing article ${m[1]}`).toBe(true);
      }
    }
  });

  it("fills placeholders and leaves unknown ones alone", () => {
    expect(fillHelp("after {MIN_NIGHTS} nights, {OTHER}", { MIN_NIGHTS: 10 })).toBe("after 10 nights, {OTHER}");
  });

  it("refuses a note without the three parts in order", () => {
    expect(() => parseChartHelp("progress/sleep.md", "---\ntitle: S\nreviewed: x\nsources: []\n---\n## How to read it\na\n## What this shows\nb\n## What to do\nc\n")).toThrow();
    expect(() => parseChartHelp("progress/nope.md", "---\ntitle: S\nreviewed: x\nsources: []\n---\n")).toThrow();
  });
});
