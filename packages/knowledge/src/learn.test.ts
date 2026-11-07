import { progressOf, startPath, togglePin, pinId } from "./learn";
import { resolveResources, resourceGroups } from "./resources";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildIndex, search, highlight, excerpt, plain } from "./search";
import { neighbours, glossaryTerms, faqItems, markRead, continueReading } from "./learn";
import { addAnswer, assessments } from "./assessments";
import { readAll } from "./content";

const mk = (id: string, title: string, summary: string, body: string) => ({ id, slug: id, section: id.split("/")[0] as any, title, summary, reviewed: "2026-01-01", sources: [], order: 1, body, words: 1 });
const list = [
  mk("basics/a", "Reality checks", "Ask whether you are dreaming.", "Pinch your nose [B1].\n\nBreathing through a pinched nose works in dreams."),
  mk("basics/b", "Sleep stages", "REM is where most dreams happen.", "Nothing here about checks."),
  mk("tools/c", "Gadgets", "Devices.", "A mask with lights."),
];

describe("search", () => {
  const idx = buildIndex(list);
  it("finds by title, summary and body and shows the matching line", () => {
    expect(search(idx, "reality")[0]).toMatchObject({ id: "basics/a", where: "title" });
    expect(search(idx, "rem")[0]).toMatchObject({ id: "basics/b", where: "summary" });
    const h = search(idx, "lights")[0]!;
    expect(h).toMatchObject({ id: "tools/c", where: "body", line: "A mask with lights." });
  });
  it("needs every word and ranks titles first", () => {
    expect(search(idx, "pinch nose").map((h) => h.id)).toEqual(["basics/a"]);
    expect(search(idx, "checks").map((h) => h.id)).toEqual(["basics/a", "basics/b"]);
    expect(search(idx, "zzz")).toEqual([]);
    expect(search(idx, "  ")).toEqual([]);
  });
  it("strips citations from lines and marks hits without HTML", () => {
    expect(plain("- Pinch [B1] it, [A3, A4].")).toBe("Pinch it.");
    expect(highlight("A <b>nose</b> test", "nose")).toEqual([{ text: "A <b>", hit: false }, { text: "nose", hit: true }, { text: "</b> test", hit: false }]);
    expect(excerpt("x".repeat(400) + " nose " + "y".repeat(400), "nose").length).toBeLessThan(200);
  });
});

describe("learn helpers", () => {
  it("finds neighbours inside the section only", () => {
    expect(neighbours(list, "basics/a")).toMatchObject({ next: { id: "basics/b" } });
    expect(neighbours(list, "basics/a").prev).toBeUndefined();
    expect(neighbours(list, "tools/c").next).toBeUndefined();
  });
  it("reads glossary terms in alphabetical order", () => {
    const t = glossaryTerms("- Zeta: last [A1].\n- Alpha (a): first one: really.\n- note without colon");
    expect(t.map((x) => x.term)).toEqual(["Alpha (a)", "Zeta"]);
    expect(t[0]!.letter).toBe("A");
    expect(JSON.stringify(t[1]!.definition)).toContain('"cite"');
  });
  it("splits the FAQ into questions", () => {
    const q = faqItems("## One?\n\nYes.\n\n## Two?\n\nNo.\n\n- x");
    expect(q.map((x) => x.question)).toEqual(["One?", "Two?"]);
    expect(q[1]!.answer).toHaveLength(2);
  });
  it("keeps the first read date and offers the next unread article", () => {
    const r = markRead({}, "basics/a", "2026-11-01");
    expect(markRead(r, "basics/a", "2026-11-05")).toBe(r);
    expect(continueReading(list, r, "basics/a")?.id).toBe("basics/b");
    expect(continueReading(list, {})?.id).toBe("basics/a");
    expect(continueReading(list, { "basics/a": "d", "basics/b": "d", "tools/c": "d" })).toBeUndefined();
  });
  it("keeps one answer a day, newest last", () => {
    const a = addAnswer([{ date: "2026-11-01", value: 2 }], { date: "2026-11-01", value: 4 });
    expect(a).toEqual([{ date: "2026-11-01", value: 4 }]);
    expect(addAnswer(a, { date: "2026-10-01", value: 1 }).map((x) => x.date)).toEqual(["2026-10-01", "2026-11-01"]);
  });
  it("scales match RESEARCH.md", () => {
    expect(assessments.ldfs.options.map((o) => o.rate)).toEqual([0, 0.042, 0.083, 0.25, 1, 2.5, 4, 8]);
    expect(assessments.madre.options.map((o) => o.rate)).toEqual([0, 0.125, 0.25, 0.625, 1, 3.5, 6.5]);
  });
});

describe("real content", () => {
  it("every glossary term, FAQ item and article is readable and searchable", async () => {
    const kb = await readAll();
    const g = kb.articles.find((a) => a.id === "glossary/glossary")!;
    expect(glossaryTerms(g.body).length).toBeGreaterThan(30);
    expect(faqItems(kb.articles.find((a) => a.id === "faq/faq")!.body).length).toBeGreaterThan(5);
    const idx = buildIndex(kb.articles);
    expect(search(idx, "reality check").length).toBeGreaterThan(0);
  });
});

describe("progress, pins and the start path", () => {
  it("counts read articles and treats an empty date as unread", () => {
    const list = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }, { id: "e" }];
    expect(progressOf(list, { a: "2026-11-01", b: "2026-11-02", c: "" })).toEqual({ read: 2, total: 5, percent: 40 });
    expect(progressOf([], {}).percent).toBe(0);
  });
  it("toggles pins in the order pinned", () => {
    expect(togglePin(["a"], "b")).toEqual(["a", "b"]);
    expect(togglePin(["a", "b"], "a")).toEqual(["b"]);
    expect(pinId.term("Reality check")).toBe("term:reality-check");
  });
  it("has a start path of real articles with no repeats", async () => {
    const kb = await readAll();
    expect(new Set(startPath).size).toBe(startPath.length);
    for (const id of startPath) expect(kb.articles.map((a) => a.id), id).toContain(id);
  });
  it("builds Resources only from references and links that appear in RESEARCH.md", async () => {
    const kb = await readAll();
    const research = readFileSync(new URL("../../../RESEARCH.md", import.meta.url), "utf8");
    for (const g of resolveResources(kb.sources)) {
      expect(g.items.length, g.id).toBeGreaterThan(0);
      for (const r of g.items) {
        for (const id of r.src) expect(kb.sources.has(id), `${r.title}: ${id}`).toBe(true);
        if (r.link) expect(research, `${r.title} link ${r.link}`).toContain(r.link);
        expect(r.title + r.by + (r.note ?? ""), r.title).not.toMatch(/[–—]|recommended|best/i);
        if (g.id === "studies") expect(r.note, r.title).toBeTruthy();
      }
    }
    expect(resourceGroups.map((g) => g.id)).toEqual(["books", "studies", "orgs", "sites", "communities"]);
  });
});
