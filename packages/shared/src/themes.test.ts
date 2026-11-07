import { describe, expect, it } from "vitest";
import * as lex from "@somnium/knowledge/lexicons";
import { suggestionKey } from "./detect";
import type { SignElement } from "./signs";
import { THEMES_MIN_DREAMS, typicalThemeRates } from "./themes";

const el = (id: string, o: Partial<SignElement> = {}): SignElement => ({ id, kind: "theme", name: id, aliases: null, isDreamSign: false, signCategory: null, confirmed: true, ...o });
const ids = (n: number) => Array.from({ length: n }, (_, i) => `d${i}`);
// a plain dream with no theme in it, so a dream counts as read
const plain = (id: string) => ({ id, text: "We had breakfast and talked." });
const row = (r: ReturnType<typeof typicalThemeRates>, id: string) => r.rows.find((x) => x.theme.id === id)!;

describe("typicalThemeRates", () => {
  it("counts a dream once per theme, from its words or a linked theme element", () => {
    const r = typicalThemeRates(ids(10), [
      { id: "d0", text: "I was being chased through a forest. Then I fell off a roof." },
      { id: "d1", title: "Chased again", text: "Something was coming after me and I was chased me down" },
      { id: "x", text: "I was being chased" }, // not in the journal's dreams: left out
      ...ids(10).slice(2).map(plain),
    ], [el("e1", { name: "Falling" }), el("e2", { name: "Ghost", aliases: "Vividly sensing a presence in the room" }), el("e3", { kind: "object", name: "Falling" })],
    [{ dreamId: "d0", elementId: "e1", source: "manual" }, { dreamId: "d2", elementId: "e1", source: "manual" }, { dreamId: "d3", elementId: "e2", source: "manual" }, { dreamId: "d4", elementId: "e3", source: "manual" }],
    lex.themes, lex);
    expect(r).toMatchObject({ total: 10, read: 10, partial: false, enough: true });
    expect(row(r, "tdq-01-chased-or-pursued-not-physically-injured")).toMatchObject({ rank: 1, dreams: 2, share: 0.2 });
    expect(row(r, "tdq-03-falling")).toMatchObject({ dreams: 2, share: 0.2 });
    expect(row(r, "tdq-10-vividly-sensing-a-presence-in-the-room").dreams).toBe(1);
    expect(r.had).toBe(3);
    expect(r.topHad).toBe(3);
    expect(row(r, "tdq-02-sexual-experiences").perDream).toMatchObject({ total: 8, men: 12, women: 4 });
    expect(r.rows).toHaveLength(55);
  });

  it("leaves out a theme dismissed for that dream, and says when there are too few dreams", () => {
    const dismissed = JSON.stringify([suggestionKey("theme", "Falling")]);
    const r = typicalThemeRates(ids(THEMES_MIN_DREAMS - 1), [{ id: "d0", text: "I fell off a cliff", dismissed }, { id: "d1", text: "I fell off a cliff" }], [], [], lex.themes, lex);
    expect(r.enough).toBe(false);
    expect(row(r, "tdq-03-falling").dreams).toBe(1);
  });

  it("divides by the dreams read, not every dream, and says when only some were read", () => {
    // 20 dreams in the journal, the newest 10 open on the device; a link on an unread dream is not counted
    const r = typicalThemeRates(ids(20), [{ id: "d0", text: "I fell off a cliff" }, ...ids(10).slice(1).map(plain)],
      [el("e1", { name: "Falling" })], [{ dreamId: "d15", elementId: "e1", source: "manual" }], lex.themes, lex);
    expect(r).toMatchObject({ total: 20, read: 10, partial: true, enough: true });
    expect(row(r, "tdq-03-falling")).toMatchObject({ dreams: 1, share: 0.1 });
  });

  it("hands the matcher only the terms whose words are all in the dream", () => {
    const seen: number[] = [];
    const spy = { stem: lex.stem, matchLexicon: (t: string, e: Parameters<typeof lex.matchLexicon>[1]) => { seen.push(e.reduce((n, x) => n + x.terms.length, 0)); return lex.matchLexicon(t, e); } };
    const r = typicalThemeRates(ids(2), [{ id: "d0", text: "I fell off a cliff" }, { id: "d1", text: "" }], [], [], lex.themes, spy);
    expect(row(r, "tdq-03-falling").dreams).toBe(1);
    const all = lex.themes.reduce((n, t) => n + t.terms.length, 0);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeGreaterThan(0);
    expect(seen[0]).toBeLessThan(all / 10);
  });

  it("is all zero with no dreams", () => {
    const r = typicalThemeRates([], [], [], [], lex.themes, lex);
    expect(r).toMatchObject({ total: 0, enough: false, had: 0, topHad: 0 });
    expect(r.rows.every((x) => x.share === 0)).toBe(true);
  });
});
