import { describe, expect, it } from "vitest";
import { articles as bundledArticles, citationsIn, parseFrontMatter, readAll, sectionIds, techniqueIds } from "./content";

const expectedSlugs: Record<string, string[]> = {
  basics: ["what-is-lucid-dreaming", "how-common-is-it", "what-it-feels-like", "is-it-real", "levels-of-lucidity", "how-this-app-helps"],
  history: ["antiquity-and-middle-ages", "tibetan-dream-yoga", "hervey-de-saint-denys", "van-eeden-and-the-word", "early-twentieth-century", "tholey-and-green", "hearne-and-laberge", "the-lucidity-institute-years", "modern-labs", "debunked-stories", "timeline"],
  science: ["sleep-and-rem", "the-lucid-brain", "two-way-communication", "what-the-evidence-says-about-techniques", "measuring-lucidity"],
  techniques: ["mild", "wbtb", "reality-testing", "tholey-combined", "dream-signs", "ada", "prospective-memory", "cat", "autosuggestion", "wild", "ssild", "fild", "deild", "vild", "re-entry", "nap", "incubation", "meditation", "sound-cue", "journaling", "stabilisation", "dream-control", "nightmares-and-lucidity"],
  traditions: ["dream-yoga-practices", "western-teachers"],
  tools: ["devices-and-apps", "existing-journal-apps"],
  substances: ["galantamine-and-others"],
  benefits: ["nightmares", "skills-and-creativity", "wellbeing"],
  safety: ["who-should-be-careful", "sleep-first", "false-awakenings-and-sleep-paralysis", "when-to-stop"],
  "dream-signs": ["what-dream-signs-are", "typical-dreams", "dream-recall", "how-the-app-finds-signs"],
  experiences: ["van-eedens-reports", "hervey-de-saint-denys-accounts", "laberge-and-the-lab", "study-participants", "community-techniques"],
  glossary: ["glossary"],
  faq: ["faq"],
};

const kb = await readAll();

describe("knowledge base content", () => {
  it("has every planned article and nothing in an unknown section", () => {
    for (const [section, slugs] of Object.entries(expectedSlugs)) {
      for (const slug of slugs) expect(kb.articles.map((a) => a.id)).toContain(`${section}/${slug}`);
    }
    for (const a of kb.articles) expect(sectionIds).toContain(a.section);
  });

  it("has valid front matter on every article", () => {
    for (const a of kb.articles) {
      expect(a.title, a.id).not.toBe("");
      expect(a.summary, a.id).not.toBe("");
      expect(a.reviewed, a.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(a.sources.length, `${a.id} lists no sources`).toBeGreaterThan(0);
    }
  });

  it("cites only sources that exist, and lists every cited source in its front matter", () => {
    expect(kb.sources.size).toBeGreaterThan(200);
    for (const a of kb.articles) {
      const cited = citationsIn(a.body);
      expect(cited.length, `${a.id} cites nothing`).toBeGreaterThan(0);
      for (const id of cited) {
        expect(kb.sources.has(id), `${a.id} cites unknown source ${id}`).toBe(true);
        expect(a.sources, `${a.id} cites ${id} but does not list it`).toContain(id);
      }
      for (const id of a.sources) expect(kb.sources.has(id), `${a.id} lists unknown source ${id}`).toBe(true);
    }
  });

  it("links tryIt only to known technique ids", () => {
    for (const a of kb.articles) if (a.tryIt) expect(techniqueIds).toContain(a.tryIt);
  });

  it("uses plain dashes only", () => {
    for (const a of kb.articles) {
      expect(a.body + a.title + a.summary, `${a.id} contains an em or en dash`).not.toMatch(/[–—]/);
    }
    for (const s of kb.sources.values()) expect(s.text, `${s.id} contains an em or en dash`).not.toMatch(/[–—]/);
  });

  it("keeps every article between 300 and 1,200 words", () => {
    for (const a of kb.articles) {
      expect(a.words, `${a.id} has ${a.words} words`).toBeGreaterThanOrEqual(300);
      expect(a.words, `${a.id} has ${a.words} words`).toBeLessThanOrEqual(1200);
    }
  });

  it("never recommends a substance", () => {
    for (const a of kb.articles) expect(a.body, a.id).not.toMatch(/\b(we|the app) recommends? (taking |using )?(galantamine|nicotine|melatonin|supplements?)\b/i);
  });

  it("gives every article a reading order, unique within its section", () => {
    for (const s of sectionIds) {
      const orders = kb.articles.filter((a) => a.section === s).map((a) => a.order);
      expect(orders.length, s).toBeGreaterThan(0);
      expect([...orders].sort((x, y) => x - y), `${s} orders must be 1..n`).toEqual(orders.map((_, i) => i + 1));
    }
  });

  it("starts the basics section with what-is-lucid-dreaming", () => {
    expect(kb.articles.find((a) => a.section === "basics")?.id).toBe("basics/what-is-lucid-dreaming");
  });

  it("sorts articles by section order then reading order", () => {
    const order = kb.articles.map((a) => sectionIds.indexOf(a.section));
    expect(order).toEqual([...order].sort((x, y) => x - y));
    for (const s of sectionIds) {
      const inSection = kb.articles.filter((a) => a.section === s).map((a) => a.order);
      expect(inSection).toEqual([...inSection].sort((x, y) => x - y));
    }
  });
});

describe("bundled loader", () => {
  it("matches the files on disk when bundled by Vite", () => {
    // vitest runs through Vite, so import.meta.glob is available here.
    expect(bundledArticles.length).toBe(kb.articles.length);
    expect(bundledArticles.map((a) => a.id)).toEqual(kb.articles.map((a) => a.id));
  });
});

describe("parseFrontMatter", () => {
  it("parses scalars and lists", () => {
    const { meta, body } = parseFrontMatter("---\ntitle: A title\nsources: [A1, B2a]\nempty: []\n---\nBody\n");
    expect(meta.title).toBe("A title");
    expect(meta.sources).toEqual(["A1", "B2a"]);
    expect(meta.empty).toEqual([]);
    expect(body).toBe("Body\n");
  });
  it("rejects a file without front matter", () => {
    expect(() => parseFrontMatter("no front matter")).toThrow();
  });
});
