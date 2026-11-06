import { describe, it, expect } from "vitest";
import { groupByNight, nightOfDate, searchJournal, matchDream, dayMarks, monthGrid, shiftMonth, mergeDraft, mergeLinks, elementMatches, nightClock, clockOf, filterActive, journalNights, type DreamDraft } from "./journal";

const night = (id: string, date: string, nap = false) => ({ id, date, nap });
const dream = (id: string, nightId: string, o: Partial<{ position: number; title: string; text: string; lucid: boolean; createdAt: string }> = {}) =>
  ({ id, nightId, position: o.position ?? 0, createdAt: o.createdAt ?? "2026-01-01T00:00:00Z", title: o.title ?? null, text: o.text ?? null, lucid: o.lucid ?? false, nightmare: false, favourite: false });

describe("groupByNight", () => {
  it("puts nights newest first, a night before its nap, dreams in the night's order", () => {
    const g = groupByNight([night("a", "2026-03-01"), night("b", "2026-03-02", true), night("c", "2026-03-02")],
      [dream("d2", "c", { position: 1 }), dream("d1", "c", { position: 0 }), dream("d3", "a")]);
    expect(g.map((x) => x.night.id)).toEqual(["c", "b", "a"]);
    expect(g[0]!.dreams.map((d) => d.id)).toEqual(["d1", "d2"]);
    expect(g[1]!.dreams).toEqual([]);
  });
  it("finds the night of a date, never a nap", () => {
    expect(nightOfDate([night("n", "2026-03-02", true), night("m", "2026-03-02")], "2026-03-02")?.id).toBe("m");
    expect(nightOfDate([night("n", "2026-03-02", true)], "2026-03-02")).toBeUndefined();
  });
});

describe("search", () => {
  const groups = groupByNight([night("a", "2026-03-01"), night("b", "2026-03-05"), night("c", "2026-03-07")], [
    dream("x", "a", { title: "The café", text: "I am walking by the sea" }),
    dream("y", "b", { text: "Flying over school", lucid: true }),
  ]);
  const els: Record<string, { id: string; name: string }[]> = { x: [{ id: "e1", name: "Grandmother" }], y: [] };
  const of = (id: string) => els[id] ?? [];
  it("matches every word in title, text and element names, without case or accents", () => {
    expect(searchJournal(groups, of, { text: "CAFE sea" }).map((g) => g.night.id)).toEqual(["a"]);
    expect(searchJournal(groups, of, { text: "grandmother" }).map((g) => g.night.id)).toEqual(["a"]);
    expect(searchJournal(groups, of, { text: "cafe flying" })).toEqual([]);
  });
  it("filters by element, dates and lucid only", () => {
    expect(searchJournal(groups, of, { elementIds: ["e1"] }).map((g) => g.night.id)).toEqual(["a"]);
    expect(searchJournal(groups, of, { lucidOnly: true }).map((g) => g.night.id)).toEqual(["b"]);
    expect(searchJournal(groups, of, { from: "2026-03-02", to: "2026-03-06" }).map((g) => g.night.id)).toEqual(["b"]);
  });
  it("keeps nights without recall only for a dates-only filter", () => {
    expect(searchJournal(groups, of, { from: "2026-03-06" }).map((g) => g.night.id)).toEqual(["c"]);
    expect(searchJournal(groups, of, { text: "a" }).some((g) => g.night.id === "c")).toBe(false);
    expect(searchJournal(groups, of, {})).toBe(groups);
    expect(filterActive({ text: "  " })).toBe(false);
  });
  it("matchDream with nothing to match is true", () => {
    expect(matchDream(dream("z", "a"), "2026-01-01", [], {})).toBe(true);
  });
});

describe("calendar", () => {
  it("marks lucid dreams apart and nights without recall", () => {
    const m = dayMarks(groupByNight([night("a", "2026-03-01"), night("b", "2026-03-02"), night("c", "2026-03-02", true)], [dream("x", "a", { lucid: true }), dream("y", "a"), dream("z", "c")]));
    expect(m.get("2026-03-01")).toEqual({ lucid: 1, other: 1, noRecall: false });
    expect(m.get("2026-03-02")).toEqual({ lucid: 0, other: 1, noRecall: false });
    expect(dayMarks(groupByNight([night("a", "2026-03-03")], [])).get("2026-03-03")!.noRecall).toBe(true);
  });
  it("lays out whole weeks from the week's first day", () => {
    const g = monthGrid(2026, 11, 1); // November 2026 starts on a Sunday
    expect(g[0]).toBe("2026-10-26");
    expect(g.length % 7).toBe(0);
    expect(g).toContain("2026-11-30");
    expect(monthGrid(2026, 11, 0)[0]).toBe("2026-11-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  });
});

describe("drafts", () => {
  const draft: DreamDraft = { dreamId: "d", nightId: "n2", date: "2026-03-02", dream: { text: "newer" }, night: {}, link: ["e2"], unlink: ["e1"], newElements: [], savedAt: Date.parse("2026-03-02T08:00:00Z") };
  it("the draft wins over an older row, the row over an older draft", () => {
    expect(mergeDraft({ id: "d", nightId: "n1", text: "old", updatedAt: "2026-03-02T07:00:00Z" }, draft)).toMatchObject({ text: "newer", nightId: "n2" });
    expect(mergeDraft({ id: "d", nightId: "n1", text: "other device", updatedAt: "2026-03-02T09:00:00Z" }, draft)).toMatchObject({ text: "other device", nightId: "n1" });
  });
  it("works with either side missing", () => {
    expect(mergeDraft(null, draft)).toMatchObject({ id: "d", text: "newer" });
    expect(mergeDraft({ id: "d", text: "x" }, null)).toEqual({ id: "d", text: "x" });
  });
  it("applies a draft's links over the row's", () => {
    expect(mergeLinks(["e1", "e3"], draft)).toEqual(["e3", "e2"]);
    expect(mergeLinks(["e1"], null)).toEqual(["e1"]);
  });
});

describe("the nights the Journal lists", () => {
  const n = (id: string, date: string, o: object = {}) => ({ id, date, nap: false, dreamCount: 0, noRecall: false, techniquesPlanned: [] as string[], ...o });
  it("leaves out a night that is only a plan until something is written", () => {
    const plan = n("p", "2026-11-06", { techniquesPlanned: ["mild"] });
    expect(journalNights([plan], "2026-11-06")).toEqual([]);
    expect(journalNights([{ ...plan, noRecall: true }], "2026-11-06").map((x) => x.id)).toEqual(["p"]);
    expect(journalNights([{ ...plan, dreamCount: 1 }], "2026-11-06").map((x) => x.id)).toEqual(["p"]);
    expect(journalNights([{ ...plan, notes: "env:x" }], "2026-11-06").map((x) => x.id)).toEqual(["p"]);
  });
  it("hides a coming morning's night only while it has no dreams", () => {
    const later = n("f", "2026-11-07", { noRecall: true, sleepQuality: 4 });
    expect(journalNights([later], "2026-11-06")).toEqual([]);
    expect(journalNights([{ ...later, dreamCount: 1 }], "2026-11-06").map((x) => x.id)).toEqual(["f"]);
    expect(journalNights([later], "2026-11-07").map((x) => x.id)).toEqual(["f"]); // its morning came
  });
});

describe("elements and times", () => {
  it("suggests names that start with the text first", () => {
    const all = [{ id: "1", name: "Mother" }, { id: "2", name: "Moon" }, { id: "3", name: "Grandmother" }, { id: "4", name: null }];
    expect(elementMatches(all, "mo", []).map((e) => e.id)).toEqual(["1", "2", "3"]);
    expect(elementMatches(all, "mother", ["1"]).map((e) => e.id)).toEqual(["3"]);
    expect(elementMatches(all, " ", [])).toEqual([]);
  });
  it("puts an evening bedtime on the day before and reads it back", () => {
    const bed = nightClock("2026-03-02", "23:30", "bed")!, wake = nightClock("2026-03-02", "06:45", "wake")!;
    expect(new Date(bed).getDate()).toBe(1);
    expect(clockOf(bed)).toBe("23:30");
    expect(clockOf(wake)).toBe("06:45");
    expect(new Date(nightClock("2026-03-02", "01:10", "bed")!).getDate()).toBe(2);
    expect(nightClock("2026-03-02", "", "bed")).toBeNull();
    expect(clockOf(null)).toBe("");
  });
});
