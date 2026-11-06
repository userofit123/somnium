import { describe, expect, it } from "vitest";
import { buildDreamMarkdown, dreamMarks, nightFacts } from "./exportDream";
import { dreamSegments, parseSpans, relatedDreams } from "./dreamPage";

const base = { title: "The long hall", text: "I walk down a hall.\nMy mother waits.", lucid: true, lucidityLevel: 3, vividness: 4, control: 2, recallClarity: null, emotionOverall: 1, nightmare: false, recurring: false, falseAwakening: true, sleepParalysis: false, favourite: false };
const night = { date: "2026-11-06", bedtime: "23:10:00", wakeTime: "07:05:00", sleepQuality: 4, wbtbUsed: true, wbtbMinutesAwake: 20, nap: false, techniquesDone: ["mild"] };

describe("dream Markdown", () => {
  it("has title, date, marks, night, text and elements, and a file name with the date only", () => {
    const { filename, markdown } = buildDreamMarkdown({ dream: base, night, elements: [{ kind: "character", name: "Mother", isDreamSign: false }, { kind: "place", name: "Hall *1*", isDreamSign: true }] });
    expect(filename).toBe("dream-2026-11-06.md");
    expect(markdown).toContain("# The long hall");
    expect(markdown).toContain("Night of 2026-11-06");
    expect(markdown).toContain("- Lucid: 3 · Lucid, some control");
    expect(markdown).toContain("- False awakening: Yes");
    expect(markdown).toContain("- WBTB: 20 min awake");
    expect(markdown).toContain("I walk down a hall.\nMy mother waits.");
    expect(markdown).toContain("- Mother (Character)");
    expect(markdown).toContain("- Hall \\*1\\* (Place) - dream sign");
    expect(markdown).not.toMatch(/[–—]/);
    expect(markdown.endsWith("\n")).toBe(true);
  });
  it("copes with no title, no text, no night and no elements", () => {
    const { filename, markdown } = buildDreamMarkdown({ dream: { ...base, title: null, text: null, lucid: false, falseAwakening: false, vividness: null, control: null, emotionOverall: null }, night: null, elements: [] });
    expect(filename).toBe("dream-undated.md");
    expect(markdown).toContain("# Untitled dream");
    expect(markdown).toContain("(No text.)");
    expect(markdown).not.toContain("## Elements");
  });
  it("keeps a title from becoming Markdown structure", () => {
    expect(buildDreamMarkdown({ dream: { ...base, title: "# x\n[a](b)" }, night, elements: [] }).markdown.split("\n")[0]).toBe("# \\# x \\[a\\](b)");
  });
  it("lists marks and facts only when noted", () => {
    expect(dreamMarks({ ...base, lucid: false, vividness: null, control: null, emotionOverall: null, falseAwakening: false })).toEqual([]);
    expect(nightFacts({ ...night, nap: true, bedtime: null, wakeTime: null, sleepQuality: null, wbtbUsed: false, techniquesDone: [] })).toEqual([{ label: "Sleep", value: "Nap" }]);
  });
});

describe("dream segments", () => {
  const text = "My mother met me. Later the mothers sang near the sea.";
  const els = [{ id: "m", name: "Mother", aliases: "mum" }, { id: "s", name: "Sea", aliases: null }];
  const kinds = (t: string, e = els, l: { elementId: string; span: string | null }[] = [], s: { key: string; spans: [number, number][] }[] = []) => dreamSegments(t, e, l, s).map((x) => [x.kind, x.text]);
  it("underlines at a stored span and cuts the text into whole pieces", () => {
    const segs = dreamSegments(text, els, [{ elementId: "m", span: "[[3,9]]" }]);
    expect(segs.map((s) => s.text).join("")).toBe(text);
    expect(segs.filter((s) => s.kind === "linked").map((s) => s.text)).toEqual(["mother"]);
  });
  it("finds the name when the span is missing or stale (the text changed)", () => {
    expect(kinds(text, els, [{ elementId: "s", span: null }]).filter((x) => x[0] === "linked")).toEqual([["linked", "sea"]]);
    expect(kinds(text, els, [{ elementId: "s", span: "[[0,2]]" }]).filter((x) => x[0] === "linked")).toEqual([["linked", "sea"]]);
    expect(kinds(text, els, [{ elementId: "s", span: "not json" }]).filter((x) => x[0] === "linked")).toEqual([["linked", "sea"]]);
  });
  it("finds an alias, and leaves out an element that is nowhere in the text", () => {
    expect(kinds("I saw mum.", els, [{ elementId: "m", span: null }]).filter((x) => x[0] === "linked")).toEqual([["linked", "mum"]]);
    expect(kinds("nothing here", els, [{ elementId: "m", span: null }])).toEqual([["plain", "nothing here"]]);
  });
  it("shows suggestions apart from confirmed elements and never over them", () => {
    const segs = dreamSegments(text, els, [{ elementId: "m", span: "[[3,9]]" }], [{ key: "a", spans: [[3, 9]] }, { key: "b", spans: [[50, 53]] }]);
    expect(segs.filter((s) => s.kind === "suggested").map((s) => s.text)).toEqual(["sea"]);
    expect(segs.map((s) => s.text).join("")).toBe(text);
  });
  it("drops spans outside the text", () => { expect(parseSpans("[[5,500],[1,3]]", 10)).toEqual([[1, 3]]); });
});

describe("related dreams", () => {
  const L = (d: string, e: string) => ({ dreamId: d, elementId: e });
  const dates: Record<string, string> = { a: "2026-01-01", b: "2026-02-01", c: "2026-03-01", d: "2026-04-01", e: "2026-05-01", f: "2026-06-01", g: "2026-07-01" };
  const dateOf = (id: string) => dates[id];
  it("needs two shared elements or a dream sign, ranks by shared, then newer", () => {
    const links = [L("a", "x"), L("a", "y"), L("a", "z"), L("b", "x"), L("c", "x"), L("c", "y"), L("d", "x"), L("d", "y"), L("d", "z"), L("e", "z")];
    expect(relatedDreams("a", links, new Set(), dateOf).map((r) => [r.id, r.shared])).toEqual([["d", 3], ["c", 2]]);
    expect(relatedDreams("a", links, new Set(["z"]), dateOf).map((r) => r.id)).toEqual(["d", "c", "e"]);
  });
  it("is at most 5 and never the dream itself or one without a date", () => {
    const links = [L("a", "x"), L("a", "y"), ...["b", "c", "d", "e", "f", "g", "h"].flatMap((d) => [L(d, "x"), L(d, "y")])];
    const r = relatedDreams("a", links, new Set(), dateOf);
    expect(r).toHaveLength(5);
    expect(r.map((x) => x.id)).toEqual(["g", "f", "e", "d", "c"]);
  });
});
