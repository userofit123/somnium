import { describe, expect, it } from "vitest";
import { actions, characters, checks, emotions, matchLexicon, matchSigns, objects, places, sensations, signs, stem, themes } from "./index";

const names = (hits: { name: string }[]) => hits.map((h) => h.name);
const subtypes = (hits: { subtype: string }[]) => hits.map((h) => h.subtype);
const count = (lexicon: readonly { terms: string[] }[]) => lexicon.reduce((n, e) => n + e.terms.length, 0);

const LUCID = "I was walking through my old school when the clock on the wall kept changing. I looked twice, and suddenly I realised I was dreaming. I floated up over the playground, completely amazed.";
const TEETH = "I was in the office talking to my boss when my teeth started to crumble. A tooth fell out into my hand and I tried to hide it.";
const DEAD = "My grandmother, who died ten years ago, was alive again. She was sitting in the kitchen making soup as if nothing had happened.";
const FLYING = "I ran to the edge of the cliff and jumped, and then I could fly. I was flying over the sea and I felt so free.";
const MUNDANE = "I went to the supermarket with my sister and bought some bread. We talked about the weekend and then we drove home.";

describe("sample dreams", () => {
  it("finds the lucid moment and the signs around it", () => {
    const hits = matchSigns(LUCID, signs);
    expect(hits.some((h) => h.subtype === "thoughts" && h.text === "I realised")).toBe(true);
    expect(hits.some((h) => h.subtype === "thoughts" && /realised I was dreaming/.test(h.text))).toBe(true);
    expect(subtypes(hits)).toContain("ego-action");
    expect(subtypes(hits)).toContain("setting-time");
    expect(names(matchLexicon(LUCID, places))).toContain("school");
    expect(names(matchLexicon(LUCID, objects))).toContain("clock");
    expect(names(matchLexicon(LUCID, sensations))).toContain("awe");
  });

  it("finds teeth falling out as action, object, theme and form sign", () => {
    expect(names(matchLexicon(TEETH, actions))).toContain("losing teeth");
    expect(names(matchLexicon(TEETH, objects))).toContain("teeth");
    expect(names(matchLexicon(TEETH, themes))).toContain("Teeth falling out / losing teeth");
    expect(subtypes(matchSigns(TEETH, signs))).toContain("ego-form");
    expect(names(matchLexicon(TEETH, characters))).toContain("boss");
  });

  it("finds a dead relative alive", () => {
    expect(names(matchLexicon(DEAD, characters))).toContain("grandmother");
    expect(names(matchLexicon(DEAD, actions))).toContain("dead person alive");
    expect(names(matchLexicon(DEAD, themes))).toContain("A person now dead as alive");
    expect(names(matchLexicon(DEAD, places))).toContain("kitchen");
    expect(matchSigns(DEAD, signs).filter((h) => h.category === "context").map((h) => h.subtype)).toContain("character-place");
  });

  it("finds flying", () => {
    expect(names(matchLexicon(FLYING, actions))).toContain("flying");
    expect(names(matchLexicon(FLYING, themes))).toContain("Flying or soaring through the air");
    expect(names(matchLexicon(FLYING, places))).toEqual(expect.arrayContaining(["cliff", "sea"]));
    expect(matchSigns(FLYING, signs).filter((h) => h.category === "action").map((h) => h.cue)).toContain("could fly");
  });

  it("reads a mundane dream without inventing anything strange", () => {
    expect(matchSigns(MUNDANE, signs)).toEqual([]);
    expect(matchLexicon(MUNDANE, themes)).toEqual([]);
    expect(names(matchLexicon(MUNDANE, places))).toContain("shop");
    expect(names(matchLexicon(MUNDANE, characters))).toContain("sister");
    expect(names(matchLexicon(MUNDANE, actions))).toEqual(expect.arrayContaining(["shopping", "talking", "driving"]));
  });
});

describe("matchLexicon", () => {
  const lexicon = [{ name: "pet", group: "animals", terms: ["cat", "dog"] }, { name: "vehicle", terms: ["car", "plane"] }, { name: "fall", terms: ["fall", "fall off the roof"] }];

  it("matches whole words only, in any case, with a span into the original text", () => {
    expect(matchLexicon("A category of catalogues", lexicon)).toEqual([]);
    expect(matchLexicon("The CAT sat", lexicon)).toEqual([{ name: "pet", group: "animals", term: "cat", start: 4, end: 7, text: "CAT" }]);
  });

  it("strips plurals, -ing and -ed on both sides", () => {
    expect(names(matchLexicon("two dogs", lexicon))).toEqual(["pet"]);
    expect(names(matchLexicon("falling", lexicon))).toEqual(["fall"]);
    expect(stem("chased")).toBe(stem("chase"));
    expect(stem("stopped")).toBe("stop");
    expect(stem("died")).toBe(stem("die"));
    expect(stem("dying")).toBe(stem("die"));
    expect(stem("zombies")).toBe(stem("zombie"));
    expect(stem("boxes")).toBe("box");
    expect(stem("houses")).toBe("house");
  });

  it("does not stem one word into another", () => {
    expect(matchLexicon("caring for her", lexicon)).toEqual([]);
    expect(stem("hated")).not.toBe("hat");
    expect(stem("news")).not.toBe("new");
    expect(stem("glasses")).not.toBe("glass");
    expect(stem("bed")).toBe("bed");
    expect(stem("king")).toBe("king");
  });

  it("keeps the longest term where terms of one entry overlap", () => {
    expect(matchLexicon("I fell, I fall off the roof", lexicon).map((h) => h.term)).toEqual(["fall off the roof"]);
  });

  it("handles curly apostrophes and possessives", () => {
    const hits = matchLexicon("I couldn’t move near the dog's bed", [{ name: "stuck", terms: ["couldn't move"] }, { name: "pet", terms: ["dog"] }]);
    expect(hits.map((h) => h.text)).toEqual(["couldn’t move", "dog's"]);
  });

  it("returns nothing for empty text", () => {
    expect(matchLexicon("", lexicon)).toEqual([]);
    expect(matchSigns("", signs)).toEqual([]);
  });
});

describe("lexicon data", () => {
  it.each([["characters", characters], ["places", places], ["objects", objects], ["actions", actions], ["sensations", sensations]] as const)("%s has 150-400 terms", (_, lexicon) => {
    expect(count(lexicon)).toBeGreaterThanOrEqual(150);
    expect(count(lexicon)).toBeLessThanOrEqual(400);
  });

  it("has lowercase terms and no typographic dashes anywhere", () => {
    for (const entry of [characters, places, objects, actions, sensations, emotions, themes].flat()) {
      for (const term of entry.terms) expect(term).toBe(term.toLowerCase());
    }
    expect(JSON.stringify([characters, places, objects, actions, sensations, emotions, themes, signs, checks])).not.toMatch(/[–—]/);
  });

  it("covers the groups named in the plan", () => {
    const groups = (lexicon: readonly { group: string }[]) => new Set(lexicon.map((e) => e.group));
    for (const g of ["family", "friends", "strangers", "authority", "celebrities", "animals", "dead", "imaginary"]) expect(groups(characters)).toContain(g);
    for (const g of ["home", "school", "work", "vehicles", "nature", "water", "city", "unknown"]) expect(groups(places)).toContain(g);
    for (const g of ["body parts", "phones and screens", "clocks", "mirrors", "doors", "vehicle parts", "weapons", "money", "food", "books and text"]) expect(groups(objects)).toContain(g);
    for (const g of ["flying", "falling", "being chased", "chasing", "running", "driving", "fighting", "talking", "searching", "hiding", "swimming", "dying", "intimacy", "eating", "climbing", "losing teeth", "being late", "taking an exam", "naked in public", "finding rooms", "unable to move or scream", "seeing dead people alive"]) expect(groups(actions)).toContain(g);
    for (const g of ["fear", "joy", "sadness", "anger", "confusion", "awe", "pain", "cold", "heat", "weightlessness", "paralysis"]) expect(groups(sensations)).toContain(g);
  });

  it("has 8 basic emotions and valence, with 40-80 cues each", () => {
    expect(emotions.filter((e) => e.group === "basic").map((e) => e.name)).toEqual(["joy", "fear", "anger", "sadness", "disgust", "surprise", "trust", "anticipation"]);
    expect(emotions.filter((e) => e.group === "valence").map((e) => e.name)).toEqual(["positive", "negative"]);
    for (const e of emotions) {
      expect(e.terms.length).toBeGreaterThanOrEqual(40);
      expect(e.terms.length).toBeLessThanOrEqual(80);
    }
  });

  it("has all 55 Nielsen themes with their published figures", () => {
    expect(themes).toHaveLength(55);
    expect(new Set(themes.map((t) => t.id)).size).toBe(55);
    expect(themes[0]).toMatchObject({ name: "Chased or pursued, not physically injured", prevalenceTotal: 81.5, prevalenceMen: 77.7, prevalenceWomen: 83.1 });
    expect(themes[37]).toMatchObject({ name: "Teeth falling out / losing teeth", prevalenceTotal: 18.8, prevalenceMen: 16.7, prevalenceWomen: 19.6 });
    expect(themes[54]).toMatchObject({ prevalenceTotal: 3.5, prevalenceMen: 5.0, prevalenceWomen: 2.9 });
    for (const t of themes) expect(t.terms.length).toBeGreaterThan(0);
  });

  it("has LaBerge's four categories and 18 sub-types, with cues that compile", () => {
    expect(signs).toHaveLength(18);
    const perCategory = (c: string) => signs.filter((s) => s.category === c).length;
    expect([perCategory("inner-awareness"), perCategory("action"), perCategory("form"), perCategory("context")]).toEqual([4, 3, 4, 7]);
    for (const s of signs) {
      expect(s.cues.length).toBeGreaterThan(0);
      for (const cue of s.cues) if (cue.startsWith("/")) expect(() => new RegExp(cue.slice(1, -1), "giu")).not.toThrow();
    }
  });

  it("has the ten reality checks, each paired and sourced", () => {
    expect(checks.map((c) => c.id).sort()).toEqual(["counting-fingers", "digital-clock", "finger-through-palm", "jumping", "light-switch", "memory-test", "mirror", "nose-pinch", "re-read-text", "turning-180"]);
    const categories = new Set(signs.map((s) => s.category));
    for (const c of checks) {
      expect(c.howTo).not.toBe("");
      expect(c.evidence).not.toBe("");
      expect(c.sources.length).toBeGreaterThan(0);
      for (const p of c.pairsWith) expect(categories).toContain(p);
    }
  });
});
