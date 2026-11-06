import { describe, expect, it } from "vitest";
import * as lex from "@somnium/knowledge/lexicons";
import { addAlias, detectElements, parseAliases, parseDismissed, suggestionKey, type DetectInput, type OwnElement } from "./detect";

const lexicons = { characters: lex.characters, places: lex.places, objects: lex.objects, actions: lex.actions, sensations: lex.sensations, emotions: lex.emotions, themes: lex.themes, signs: lex.signs };
const match = { matchLexicon: lex.matchLexicon, stem: lex.stem };
const run = (text: string, more: Partial<DetectInput> = {}) => detectElements({ text, own: [], lexicons, match, ...more });
const names = (s: ReturnType<typeof run>) => s.map((x) => x.name.toLowerCase());
const spanText = (text: string, s: { spans: [number, number][] }) => s.spans.map(([a, b]) => text.slice(a, b));

const LUCID = `I was walking through my old school at night, the corridors were longer than they should be. I looked at the clock in the hall and the numbers kept changing. Suddenly I realized I was dreaming! I jumped and started flying over the playground, the wind on my face. I felt so free and happy. My grandmother, who died years ago, was standing by the gate and waved at me. I tried to stay calm so I wouldn't wake up.`;
const NIGHTMARE = `Someone was chasing me through a dark forest. I couldn't see his face. I ran and ran but my legs felt heavy, like moving through mud. I hid in an abandoned house but he found me. My teeth started falling out into my hand. I screamed but no sound came out. I woke up sweating, my heart pounding, terrified.`;
const MUNDANE = `I was at the supermarket buying groceries with my sister. We argued about which bread to get. Then we drove home in her car and I made coffee in the kitchen. Nothing unusual happened, it felt like a normal Tuesday.`;

describe("detectElements", () => {
  it("reads a lucid dream: places, people, actions, a theme and dream signs", () => {
    const s = run(LUCID);
    const n = names(s);
    expect(n).toContain("school");
    expect(n).toContain("grandmother");
    expect(s.some((x) => x.type === "element" && x.kind === "action" && /fly/.test(x.name.toLowerCase()))).toBe(true);
    expect(s.some((x) => x.type === "theme" && /fly/i.test(x.name))).toBe(true);
    const signs = s.filter((x) => x.type === "sign");
    expect(signs.length).toBeGreaterThan(0);
    expect(signs.every((x) => x.kind === "dream_sign" && x.signCategory)).toBe(true);
    // a dead grandmother alive, and "I realized I was dreaming", are LaBerge signs
    expect(signs.map((x) => x.signCategory)).toContain("inner_awareness");
    expect(s.length).toBeLessThanOrEqual(12);
  });

  it("reads a nightmare: chased, teeth, fear", () => {
    const s = run(NIGHTMARE);
    expect(s.some((x) => x.type === "theme" && /chased/i.test(x.name))).toBe(true);
    expect(names(s)).toContain("teeth");
    expect(s.some((x) => x.kind === "emotion" && x.name.toLowerCase() === "fear")).toBe(true);
    expect(names(s)).toContain("forest");
  });

  it("keeps a mundane dream mundane: places and people, no dream signs", () => {
    const s = run(MUNDANE);
    const n = names(s);
    expect(n).toContain("sister");
    expect(n).toContain("shop"); // the supermarket, under the lexicon's name
    expect(s.filter((x) => x.type === "sign")).toEqual([]);
    // very common words are offered, but below the specific ones
    const car = s.find((x) => x.name.toLowerCase() === "car"), sup = s.find((x) => x.name.toLowerCase() === "shop")!;
    if (car) expect(car.confidence).toBeLessThan(sup.confidence);
  });

  it("puts the person's own elements and aliases first, with high confidence", () => {
    const own: OwnElement[] = [
      { id: "e-max", name: "Max", kind: "character", aliases: "my dog, the dog" },
      { id: "e-gran", name: "Grandmother", kind: "character", aliases: "Nana" },
      { id: "e-lake", name: "Lake Bled", kind: "place", aliases: null },
    ];
    const text = "Nana and I took my dog for a walk by Lake Bled. Max jumped into the lake and my grandmother laughed. The dog swam to an island.";
    const s = run(text, { own });
    expect(s[0]!.sources).toEqual(["own"]);
    const max = s.find((x) => x.existingElementId === "e-max")!;
    expect(max.confidence).toBeGreaterThanOrEqual(0.9);
    expect(spanText(text, max)).toEqual(["my dog", "Max", "The dog"]);
    const gran = s.find((x) => x.existingElementId === "e-gran")!;
    expect(spanText(text, gran)).toEqual(["Nana", "grandmother"]);
    expect(s.find((x) => x.existingElementId === "e-lake")).toBeTruthy();
    // the lexicon's "dog" and "grandmother" became the person's own, not second suggestions
    expect(s.filter((x) => /^(dog|grandmother)$/i.test(x.name) && !x.existingElementId)).toEqual([]);
  });

  it("matches a lexicon word to an element of the same name the person already has", () => {
    const own: OwnElement[] = [{ id: "e-mum", name: "Mother", kind: "character", aliases: null }];
    const s = run("My mom was baking bread.", { own });
    const mum = s.find((x) => x.existingElementId === "e-mum")!;
    expect(mum.sources).toContain("own");
    expect(mum.sources).toContain("characters");
  });

  it("merges hits by name: one suggestion, many spans", () => {
    const text = "The spider crawled up the wall. Another spider. Then spiders everywhere.";
    const sp = run(text).filter((x) => x.name.toLowerCase() === "spider");
    expect(sp).toHaveLength(1);
    expect(sp[0]!.spans).toHaveLength(3);
  });

  it("never suggests what is linked, or what was dismissed", () => {
    const own: OwnElement[] = [{ id: "e-sis", name: "Sister", kind: "character", aliases: null }];
    const s = run(MUNDANE, { own, linked: ["e-sis"], dismissed: [suggestionKey("place", "shop")] });
    expect(names(s)).not.toContain("sister");
    expect(names(s)).not.toContain("shop");
  });

  it("caps at the asked number, best first", () => {
    const s = run(`${LUCID} ${NIGHTMARE} ${MUNDANE}`);
    expect(s).toHaveLength(12);
    expect(s.filter((x) => x.type === "sign").length).toBeLessThanOrEqual(3);
    for (let i = 1; i < s.length; i++) if (s[i]!.sources.includes("own") === s[i - 1]!.sources.includes("own")) expect(s[i]!.confidence).toBeLessThanOrEqual(s[i - 1]!.confidence);
  });

  it("returns nothing for empty text", () => {
    expect(run("   ")).toEqual([]);
  });

  it("stays well under 50 ms on a 3,000-word dream", () => {
    const own: OwnElement[] = Array.from({ length: 200 }, (_, i) => ({ id: `e${i}`, name: `Person ${i}`, kind: "character" as const, aliases: `p${i}, friend ${i}` }));
    const base = `${LUCID} ${NIGHTMARE} ${MUNDANE}`;
    const words = base.split(/\s+/);
    const long = Array.from({ length: 3000 }, (_, i) => words[i % words.length]).join(" ");
    run(long, { own }); // warm: the lexicon terms are stemmed once and kept
    // the middle of five runs, so a busy test machine does not decide it
    const times: number[] = [];
    let s: ReturnType<typeof run> = [];
    for (let k = 0; k < 5; k++) { const t0 = performance.now(); s = run(long, { own }); times.push(performance.now() - t0); }
    const ms = times.sort((x, y) => x - y)[2]!;
    console.log(`detect: 3,000 words in ${ms.toFixed(1)} ms`);
    expect(s.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(50);
  });
});

describe("aliases and dismissals", () => {
  it("parses and adds aliases without duplicates", () => {
    expect(parseAliases("Nana, gran\nGranny ")).toEqual(["Nana", "gran", "Granny"]);
    expect(addAlias({ name: "Grandmother", aliases: "Nana" }, "gran")).toBe("Nana, gran");
    expect(addAlias({ name: "Grandmother", aliases: "Nana" }, "nana")).toBeNull();
    expect(addAlias({ name: "Grandmother", aliases: null }, "grandmother")).toBeNull();
  });
  it("reads a damaged dismissal list as empty", () => {
    expect(parseDismissed('["place:home"]')).toEqual(["place:home"]);
    expect(parseDismissed("nope")).toEqual([]);
    expect(parseDismissed(null)).toEqual([]);
  });
});
