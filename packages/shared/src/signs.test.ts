import { describe, expect, it } from "vitest";
import * as lex from "@somnium/knowledge/lexicons";
import { daysBetween } from "./course";
import {
  categoryWeight, coOccurrence, elementStats, elementsByKind, elementSuggestions, frequencyText, isSignCandidate, lucidSplit,
  mergePlan, pairedCheck, recencyWeight, signFrequency, signScore, signsBeforeLucidity, signShortlist, themeComparison,
  type SignDream, type SignElement, type SignLink,
} from "./signs";

const TODAY = "2026-11-07";
const el = (id: string, o: Partial<SignElement> = {}): SignElement => ({ id, kind: "object", name: id, aliases: null, isDreamSign: false, signCategory: null, confirmed: true, ...o });
const dream = (id: string, date: string, lucid = false): SignDream => ({ id, date, lucid });
const link = (dreamId: string, elementId: string, source: SignLink["source"] = "manual"): SignLink => ({ dreamId, elementId, source });

describe("elementStats", () => {
  const dreams = [dream("d1", "2026-11-07"), dream("d2", "2026-11-01"), dream("d3", "2026-10-01"), dream("d4", "2026-05-01")];
  const links = [link("d1", "a"), link("d1", "a"), link("d2", "a"), link("d3", "a"), link("d4", "a"), link("gone", "a"), link("d1", "b")];
  const s = elementStats([el("a"), el("b")], links, dreams, TODAY);
  it("counts each dream once and skips links to dreams that are gone", () => {
    expect(s.get("a")!.dreamCount).toBe(4);
    expect(s.get("a")!.firstSeen).toBe("2026-05-01");
    expect(s.get("a")!.lastSeen).toBe("2026-11-07");
    expect(s.get("b")!.dreamCount).toBe(1);
  });
  it("counts the last 30 days and a 12-week series ending this week", () => {
    expect(s.get("a")!.recent30).toBe(2);
    const w = s.get("a")!.weekly;
    expect(w).toHaveLength(12);
    expect(w[11]).toBe(2); // today and 6 days ago
    expect(w[11 - Math.floor(daysBetween("2026-10-01", TODAY) / 7)]).toBe(1);
    expect(w.reduce((x, y) => x + y, 0)).toBe(3); // May is beyond 12 weeks
  });
});

describe("coOccurrence", () => {
  it("counts shared dreams per other element, most first", () => {
    const links = [link("d1", "a"), link("d1", "b"), link("d2", "a"), link("d2", "b"), link("d2", "c"), link("d3", "c")];
    expect(coOccurrence("a", links)).toEqual([{ elementId: "b", count: 2 }, { elementId: "c", count: 1 }]);
    expect(coOccurrence("a", links, new Set(["d1"]))).toEqual([{ elementId: "b", count: 1 }]);
  });
});

describe("candidate rule and score", () => {
  const dreams = [dream("d1", "2026-11-06"), dream("d2", "2026-11-01"), dream("d3", "2026-06-01"), dream("d4", "2026-05-01"), dream("d5", "2026-04-01")];
  it("needs 3 dreams, or 2 within 30 days, and a sign-ish category or a mark", () => {
    const links = [link("d1", "two"), link("d2", "two"), link("d3", "old2"), link("d4", "old2"), link("d3", "three"), link("d4", "three"), link("d5", "three"), link("d1", "plain"), link("d2", "plain"), link("d3", "plain")];
    const els = [el("two", { signCategory: "form" }), el("old2", { signCategory: "form" }), el("three", { kind: "dream_sign" }), el("plain"), el("marked", { isDreamSign: true })];
    const s = elementStats(els, links, dreams, TODAY);
    const ok = (id: string) => isSignCandidate(els.find((e) => e.id === id)!, s.get(id)!);
    expect(ok("two")).toBe(true);
    expect(ok("old2")).toBe(false); // 2 dreams, but not within 30 days
    expect(ok("three")).toBe(true);
    expect(ok("plain")).toBe(false); // frequent but not sign-ish
    expect(ok("marked")).toBe(false); // marked but never seen
  });
  it("weights recency by a 30-day half-life with a floor, and categories as documented", () => {
    expect(recencyWeight(TODAY, TODAY)).toBe(1);
    expect(recencyWeight("2026-10-08", TODAY)).toBeCloseTo(0.5);
    expect(recencyWeight("2020-01-01", TODAY)).toBe(0.1);
    expect(categoryWeight(el("x", { signCategory: "form" }))).toBe(1.2);
    expect(categoryWeight(el("x", { signCategory: "inner_awareness", isDreamSign: true }))).toBeCloseTo(1.125);
    const s = elementStats([el("x")], [link("d1", "x"), link("d2", "x")], dreams, TODAY).get("x")!;
    expect(signScore(el("x", { signCategory: "action" }), s, TODAY)).toBeCloseTo(2 * 0.5 ** (1 / 30) * 1.2);
  });
});

describe("signShortlist", () => {
  const minus = (n: number) => new Date(Date.UTC(2026, 10, 7 - n)).toISOString().slice(0, 10);
  const ds = Array.from({ length: 25 }, (_, i) => dream(`d${i}`, minus(i * 3)));
  const links: SignLink[] = [];
  for (let i = 0; i < 6; i++) links.push(link(`d${i}`, "teeth"));
  for (let i = 0; i < 3; i++) links.push(link(`d${i}`, "late"));
  for (let i = 20; i < 25; i++) links.push(link(`d${i}`, "old"));
  for (let i = 0; i < 8; i++) links.push(link(`d${i}`, "dog"));
  const els = [el("teeth", { kind: "dream_sign", signCategory: "form" }), el("late", { signCategory: "context", isDreamSign: true }), el("old", { signCategory: "action" }), el("dog")];
  const stats = elementStats(els, links, ds, TODAY);
  const list = signShortlist(els, stats, ds, lex.checks, TODAY);
  it("ranks candidates, leaves out what isn't sign-ish, and pairs a check", () => {
    expect(list.map((x) => x.element.id)).toEqual(["teeth", "late", "old"]);
    expect(list[0]!.check?.pairsWith).toContain("form");
    expect(list[1]!.check?.pairsWith).toContain("context");
    expect(list[0]!.advice).toMatch(/looks wrong/);
  });
  it("writes the frequency line against the last 20 dreams", () => {
    expect(frequencyText(list[0]!.frequency)).toBe("in 6 of your last 20 dreams");
    expect(frequencyText(list[2]!.frequency)).toBe("in 5 of your 25 dreams, none of your last 20");
    expect(frequencyText(signFrequency(stats.get("late")!, ds.slice(0, 4)))).toBe("in 3 of your 4 dreams");
  });
  it("keeps 5 at most", () => {
    const many = Array.from({ length: 8 }, (_, i) => el(`s${i}`, { signCategory: "form" }));
    const l2 = many.flatMap((e) => [link("d0", e.id), link("d1", e.id)]);
    expect(signShortlist(many, elementStats(many, l2, ds, TODAY), ds, lex.checks, TODAY)).toHaveLength(5);
  });
  it("pairs re-reading text when there is no category", () => {
    expect(pairedCheck(null, lex.checks)?.id).toBe("re-read-text");
    expect(pairedCheck("inner_awareness", lex.checks)?.pairsWith).toContain("inner-awareness");
  });
});

describe("elementsByKind and suggestions", () => {
  const dreams = [dream("d1", "2026-11-01"), dream("d2", "2026-11-02"), dream("d3", "2026-11-03")];
  const els = [el("Dog", { kind: "character", aliases: "puppy, hound" }), el("Cat", { kind: "character" }), el("School", { kind: "place", confirmed: false }), el("Bus", { confirmed: false }), el("Car", { confirmed: false })];
  const links = [link("d1", "Dog"), link("d2", "Dog"), link("d1", "Cat"), link("d1", "School", "detected"), link("d2", "School", "ocr"), link("d1", "Bus", "detected"), link("d2", "Bus", "manual"), link("d1", "Car", "detected")];
  const stats = elementStats(els, links, dreams, TODAY);
  it("groups by kind in the fixed order, most dreams first, searching aliases too", () => {
    const g = elementsByKind(els, stats);
    expect(g.map((x) => x.kind)).toEqual(["character", "place", "object"]);
    expect(g[0]!.rows.map((r) => r.element.id)).toEqual(["Dog", "Cat"]);
    expect(elementsByKind(els, stats, "HOUN").flatMap((x) => x.rows.map((r) => r.element.id))).toEqual(["Dog"]);
  });
  it("suggests unconfirmed, detected-only elements found in 2 or more dreams", () => {
    expect(elementSuggestions(els, links, stats).map((x) => x.element.id)).toEqual(["School"]);
  });
});

describe("mergePlan", () => {
  it("moves links the target lacks, drops the rest, and keeps every name as an alias", () => {
    const from = el("f", { name: "Puppy", aliases: "pup, Dog" }), into = el("i", { name: "Dog", aliases: "hound" });
    const links = [link("d1", "f"), link("d2", "f"), link("d2", "i")];
    const p = mergePlan(from, into, links);
    expect(p.repoint.map((l) => l.dreamId)).toEqual(["d1"]);
    expect(p.drop.map((l) => l.dreamId)).toEqual(["d2"]);
    expect(p.aliases).toBe("hound, Puppy, pup");
  });
});

describe("lucidity", () => {
  it("splits the lucid rate with and without an element, with sizes", () => {
    const dreams = [dream("a", TODAY, true), dream("b", TODAY), dream("c", TODAY, true), dream("d", TODAY)];
    expect(lucidSplit("x", [link("a", "x"), link("b", "x")], dreams)).toEqual({ with: { dreams: 2, lucid: 1 }, without: { dreams: 2, lucid: 1 } });
  });
  it("says not enough dreams under 10", () => {
    expect(signsBeforeLucidity([], [], Array.from({ length: 9 }, (_, i) => dream(`d${i}`, TODAY)))).toEqual({ enough: false, dreams: 9, needed: 10 });
  });
  it("counts signs in lucid against non-lucid dreams, signs only", () => {
    const dreams = Array.from({ length: 10 }, (_, i) => dream(`d${i}`, TODAY, i < 3));
    const els = [el("fly", { signCategory: "action" }), el("teeth", { kind: "dream_sign" }), el("dog")];
    const links = [link("d0", "fly"), link("d1", "fly"), link("d5", "fly"), link("d6", "teeth"), link("d0", "dog")];
    const r = signsBeforeLucidity(els, links, dreams);
    expect(r.enough).toBe(true);
    if (!r.enough) return;
    expect(r.lucidDreams).toBe(3);
    expect(r.otherDreams).toBe(7);
    expect(r.rows.map((x) => [x.element.id, x.inLucid, x.inOther])).toEqual([["fly", 2, 1], ["teeth", 0, 1]]);
  });
});

describe("themeComparison", () => {
  it("matches theme elements to the Nielsen list by name, screen name or alias", () => {
    const falling = lex.themes.find((t) => t.name === "Falling")!;
    const chased = lex.themes.find((t) => t.id.startsWith("tdq-01"))!;
    const els = [el("t1", { kind: "theme", name: "falling" }), el("t2", { kind: "theme", name: chased.name }), el("t4", { kind: "theme", name: "Late again", aliases: "trains, Arriving too late (e.g. missing a train)" }), el("t3", { kind: "theme", name: "Not a theme" })];
    const dreams = [dream("d1", TODAY), dream("d2", TODAY)];
    const stats = elementStats(els, [link("d1", "t1"), link("d2", "t1"), link("d1", "t2"), link("d1", "t3"), link("d2", "t4")], dreams, TODAY);
    const r = themeComparison(els, stats, lex.themes);
    expect(r.map((x) => [x.theme.id, x.yourDreams])).toEqual([[falling.id, 2], [chased.id, 1], ["tdq-05-arriving-too-late", 1]]);
    expect(r[0]!.theme.prevalenceTotal).toBe(73.8);
  });
});
