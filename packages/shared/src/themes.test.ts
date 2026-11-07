import { describe, expect, it } from "vitest";
import * as lex from "@somnium/knowledge/lexicons";
import { suggestionKey } from "./detect";
import type { SignElement } from "./signs";
import { THEMES_MIN_DREAMS, typicalThemeRates } from "./themes";

const el = (id: string, o: Partial<SignElement> = {}): SignElement => ({ id, kind: "theme", name: id, aliases: null, isDreamSign: false, signCategory: null, confirmed: true, ...o });
const ids = (n: number) => Array.from({ length: n }, (_, i) => `d${i}`);
const row = (r: ReturnType<typeof typicalThemeRates>, id: string) => r.rows.find((x) => x.theme.id === id)!;

describe("typicalThemeRates", () => {
  it("counts a dream once per theme, from its words or a linked theme element", () => {
    const r = typicalThemeRates(ids(10), [
      { id: "d0", text: "I was being chased through a forest. Then I fell off a roof." },
      { id: "d1", title: "Chased again", text: "Something was coming after me and I was chased me down" },
      { id: "x", text: "I was being chased" }, // not in the journal's dreams: left out
    ], [el("e1", { name: "Falling" }), el("e2", { name: "Ghost", aliases: "Vividly sensing a presence in the room" }), el("e3", { kind: "object", name: "Falling" })],
    [{ dreamId: "d0", elementId: "e1", source: "manual" }, { dreamId: "d2", elementId: "e1", source: "manual" }, { dreamId: "d3", elementId: "e2", source: "manual" }, { dreamId: "d4", elementId: "e3", source: "manual" }],
    lex.themes, lex.matchLexicon);
    expect(r).toMatchObject({ total: 10, enough: true });
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
    const r = typicalThemeRates(ids(THEMES_MIN_DREAMS - 1), [{ id: "d0", text: "I fell off a cliff", dismissed }, { id: "d1", text: "I fell off a cliff" }], [], [], lex.themes, lex.matchLexicon);
    expect(r.enough).toBe(false);
    expect(row(r, "tdq-03-falling").dreams).toBe(1);
  });

  it("is all zero with no dreams", () => {
    const r = typicalThemeRates([], [], [], [], lex.themes, lex.matchLexicon);
    expect(r).toMatchObject({ total: 0, enough: false, had: 0, topHad: 0 });
    expect(r.rows.every((x) => x.share === 0)).toBe(true);
  });
});
