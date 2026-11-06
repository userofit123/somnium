import { describe, expect, it } from "vitest";
import { citationsIn, readAll, techniqueIds } from "./content";
import { readdir, readFile } from "node:fs/promises";
import { lessons as bundledLessons, lessonIds, loadLessons, parseLesson } from "./course";
import { techniques, families, safetyLines } from "./techniques";

const kb = await readAll();
// the files on disk, read directly (course.ts stays free of Node imports: it ships in the web bundle)
const dir = new URL("../content/course/", import.meta.url);
const list = loadLessons(Object.fromEntries(await Promise.all((await readdir(dir)).filter((n) => n.endsWith(".md")).map(async (n) => [n, await readFile(new URL(n, dir), "utf8")] as const))));

describe("course lessons", () => {
  it("has the eight lessons of PLAN.md §8.1, in order", () => {
    expect(list.map((l) => l.id)).toEqual([...lessonIds]);
    expect(list.map((l) => l.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(bundledLessons.map((l) => l.id)).toEqual([...lessonIds]);
  });

  it("is not loaded as Learn articles", () => {
    expect(kb.articles.some((a) => a.id.startsWith("course/"))).toBe(false);
  });

  it("cites only sources that exist, and lists every cited one", () => {
    for (const l of list) {
      const text = l.body + "\n" + l.practice.join("\n");
      const cited = citationsIn(text);
      expect(cited.length, `${l.id} cites nothing`).toBeGreaterThan(0);
      for (const id of cited) {
        expect(kb.sources.has(id), `${l.id} cites unknown source ${id}`).toBe(true);
        expect(l.sources, `${l.id} cites ${id} but does not list it`).toContain(id);
      }
      for (const id of l.sources) expect(kb.sources.has(id), `${l.id} lists unknown source ${id}`).toBe(true);
    }
  });

  it("uses plain dashes only", () => {
    for (const l of list) expect(l.body + l.title + l.summary + l.practice.join(""), l.id).not.toMatch(/[–—]/);
  });

  it("has 2-4 practice items and a move-on section in every lesson", () => {
    for (const l of list) {
      expect(l.practice.length, l.id).toBeGreaterThanOrEqual(2);
      expect(l.practice.length, l.id).toBeLessThanOrEqual(4);
      for (const p of l.practice) expect(p.length, `${l.id}: ${p}`).toBeLessThanOrEqual(120);
      expect(l.body, l.id).toMatch(/^## Ready to move on$/m);
      expect(l.body, l.id).not.toMatch(/Today's practice/);
    }
  });

  it("shows the safety note on the WBTB, SSILD/WILD, nightmare and troubleshooting lessons", () => {
    expect(list.filter((l) => l.safety).map((l) => l.id)).toEqual(["mild-wbtb", "ssild-wild", "dream-control", "troubleshooting"]);
  });

  it("refuses a lesson without a practice list", () => {
    expect(() => parseLesson("course/01-recall.md", "---\ntitle: T\nsummary: S\nreviewed: 2026-01-01\nsources: [B1]\n---\nBody [B1]\n")).toThrow();
  });
});

describe("techniques library", () => {
  it("covers every technique article exactly once, in a known family", () => {
    const slugs = kb.articles.filter((a) => a.section === "techniques").map((a) => a.slug).sort();
    expect(techniques.map((t) => t.slug).sort()).toEqual(slugs);
    for (const t of techniques) {
      expect(techniqueIds).toContain(t.id);
      expect(families.map((f) => f.id)).toContain(t.family);
      expect(kb.articles.find((a) => a.slug === t.slug)?.tryIt, t.id).toBe(t.id);
    }
  });

  it("grounds each evidence badge in a cited source", () => {
    for (const t of techniques) {
      const cited = citationsIn(t.basis);
      expect(cited.length, t.id).toBeGreaterThan(0);
      for (const id of cited) expect(kb.sources.has(id), `${t.id} cites unknown ${id}`).toBe(true);
      expect(t.basis, t.id).not.toMatch(/[–—]/);
    }
    for (const line of safetyLines) for (const id of citationsIn(line)) expect(kb.sources.has(id), id).toBe(true);
  });

  it("keeps the RESEARCH.md Part B summary table's grades", () => {
    const grade = Object.fromEntries(techniques.map((t) => [t.id, t.evidence]));
    expect(grade).toMatchObject({ mild: "strong", wbtb: "some", "sound-cue": "strong", ssild: "some", "reality-testing": "weak", "tholey-combined": "some", wild: "anecdotal", deild: "anecdotal", journaling: "some", meditation: "weak" });
    expect(techniques.find((t) => t.id === "reality-testing")?.basis).toMatch(/part of MILD, not alone/);
    expect(safetyLines.join(" ")).toMatch(/grief or PTSD without clinical support \(nightmare work is best done with a therapist\)/);
    expect(techniques.filter((t) => t.safety).map((t) => t.id).sort()).toEqual(["deild", "fild", "re-entry", "ssild", "wbtb", "wild"]);
  });
});
