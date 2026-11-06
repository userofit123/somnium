import { describe, expect, it } from "vitest";
import { buildIndex, search, highlight, excerpt, plain } from "./search";
import { neighbours, glossaryTerms, faqItems, markRead, continueReading } from "./learn";
import { addAnswer, assessments } from "./assessments";
import { readAll } from "./content";

const mk = (id: string, title: string, summary: string, body: string) => ({ id, slug: id, section: id.split("/")[0] as any, title, summary, reviewed: "2026-01-01", sources: [], body, words: 1 });
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
