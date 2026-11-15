import { describe, expect, it } from "vitest";
import { tipIndex, homeNights, morningState, morningLine, nextReminder, checksOn, homeRates, recallLine, lastLucid, pastDream, type HomeDream, type PastSign } from "./home";
import { addDays } from "./rates";

const night = (id: string, date: string, o: Record<string, unknown> = {}) => ({ id, date, nap: false, dreamCount: 0, noRecall: false, ...o });
const dream = (id: string, nightId: string, date: string, o: Partial<HomeDream> = {}): HomeDream => ({ id, nightId, date, lucid: false, ...o });

describe("homeNights", () => {
  it("last night is today's night; tonight is tomorrow from 05:00", () => {
    expect(homeNights("2026-11-07", 9)).toEqual({ lastNight: "2026-11-07", tonight: "2026-11-08", same: false });
    expect(homeNights("2026-11-07", 5)).toEqual({ lastNight: "2026-11-07", tonight: "2026-11-08", same: false });
    expect(homeNights("2026-12-31", 22).tonight).toBe("2027-01-01");
  });
  it("before 05:00 tonight is still the night in progress", () => {
    expect(homeNights("2026-11-07", 4)).toEqual({ lastNight: "2026-11-07", tonight: "2026-11-07", same: true });
    expect(homeNights("2026-11-07", 0).same).toBe(true);
  });
});

describe("morningState", () => {
  it("is open with no night, or a night that only holds tonight's plan", () => {
    expect(morningState([], [], "2026-11-07")).toEqual({ kind: "open" });
    const plan = night("p", "2026-11-07", { techniquesPlanned: ["mild"], intention: "fly" });
    expect(morningState([plan], [], "2026-11-07")).toEqual({ kind: "open" });
    expect(morningLine({ kind: "open" })).toBe("");
  });
  it("is closed by a no-recall mark", () => {
    const s = morningState([night("n", "2026-11-07", { noRecall: true })], [], "2026-11-07");
    expect(s).toEqual({ kind: "noRecall" });
    expect(morningLine(s)).toBe("No recall");
  });
  it("summarises the night's dreams, leaving out naps, other nights and deleted dreams", () => {
    const nights = [night("n", "2026-11-07"), { ...night("nap", "2026-11-07"), nap: true }, night("y", "2026-11-06")];
    const dreams = [
      dream("a", "n", "2026-11-07", { title: "The library", lucid: true }),
      dream("b", "n", "2026-11-07", { nightmare: true, title: "  " }),
      dream("c", "nap", "2026-11-07", { lucid: true }),
      dream("d", "y", "2026-11-06"),
      dream("e", "n", "2026-11-07", { deletedAt: "2026-11-07T08:00:00Z" }),
    ];
    const s = morningState(nights, dreams, "2026-11-07");
    expect(s).toEqual({ kind: "logged", dreams: 2, lucid: 1, nightmare: true, titled: [{ id: "a", title: "The library" }] });
    expect(morningLine(s)).toBe("2 dreams · 1 lucid · a nightmare");
    expect(morningLine({ kind: "logged", dreams: 1, lucid: 0, nightmare: false, titled: [] })).toBe("1 dream · not lucid");
    expect(morningLine({ kind: "logged", dreams: 1, lucid: 1, nightmare: false, titled: [] })).toBe("1 dream · lucid");
  });
  it("a dream wins over a stray no-recall mark", () => {
    expect(morningState([night("n", "2026-11-07", { noRecall: true })], [dream("a", "n", "2026-11-07")], "2026-11-07").kind).toBe("logged");
  });
});

describe("progress strings", () => {
  it("next reminder and today's checks", () => {
    expect(nextReminder([300, 100, 200], 150)).toBe(200);
    expect(nextReminder([100], 150)).toBeNull();
    expect(checksOn(["2026-11-07", "2026-11-06", "2026-11-07"], "2026-11-07")).toBe(2);
  });
});

describe("homeRates", () => {
  const today = "2026-11-07";
  it("counts recall over 14 days of logged nights, leaving plans and older nights out", () => {
    const nights = [
      night("a", "2026-11-07", { dreamCount: 1 }),
      night("b", "2026-11-06", { noRecall: true }),
      night("c", "2026-11-05", { dreamCount: 2 }),
      night("p", "2026-11-08", { techniquesPlanned: ["mild"] }), // tonight's plan: future and plan-only
      night("q", "2026-11-03", { techniquesPlanned: ["wbtb"] }), // an old plan never written up
      night("old", "2026-10-24", { dreamCount: 3 }), // 14 days back is 10-25
    ];
    const r = homeRates(nights, [], today);
    expect(r.recall).toEqual({ rate: 2 / 3, withDreams: 2, logged: 3, days: 14 });
    expect(recallLine(r.recall)).toEqual({ value: "67%", sub: "2 of 3 logged nights" });
    expect(r.streak).toBe(3);
  });
  it("keeps the streak while this morning is not logged yet, and a plan doesn't extend it", () => {
    const nights = [night("p", "2026-11-07", { techniquesPlanned: ["mild"] }), night("y", "2026-11-06", { dreamCount: 1 }), night("z", "2026-11-05", { noRecall: true })];
    expect(homeRates(nights, [], today).streak).toBe(2);
  });
  it("says so with no logged nights", () => {
    expect(recallLine(homeRates([], [], today).recall)).toEqual({ value: "-", sub: "No logged nights in 14 days" });
  });
  it("counts lucid dreams this month and finds the last one", () => {
    const dreams = [dream("1", "a", "2026-11-02", { lucid: true }), dream("2", "b", "2026-10-31", { lucid: true }), dream("3", "c", "2026-11-05"), dream("4", "d", "2026-11-05", { lucid: true }), dream("5", "d", "2026-11-05", { lucid: true, deletedAt: "x" })];
    expect(homeRates([], dreams, today).lucidThisMonth).toBe(2);
    expect(lastLucid(dreams)?.id).toBe("4");
    expect(lastLucid([])).toBeNull();
  });
  it("counts lucid dreams this month from the nights' counts, naps' dreams included, whatever dreams are loaded", () => {
    const nights = [night("a", "2026-11-02", { lucidCount: 1 }), night("n", "2026-11-02", { nap: true, lucidCount: 1 }), night("o", "2026-10-30", { lucidCount: 3 })];
    expect(homeRates(nights, [], today).lucidThisMonth).toBe(2);
  });
  it("adds the recall line from Progress once both sides have 7 nights", () => {
    const n = (k: number, dreams: number) => night(`r${k}`, addDays(today, -k), { dreamCount: dreams, noRecall: !dreams });
    const early = Array.from({ length: 7 }, (_, i) => n(40 - i, i % 2 ? 0 : 1));
    const late = Array.from({ length: 7 }, (_, i) => n(6 - i, 2));
    expect(homeRates([...early, ...late], [], today).recallChange).toBe("Up from 0.6 to 2 dreams a night, against your first logged nights");
    expect(homeRates(late, [], today).recallChange).toBe("");
  });
});

describe("tipIndex", () => {
  it("is stable for a day and within range", () => {
    expect(tipIndex("2026-11-07", 40)).toBe(tipIndex("2026-11-07", 40));
    for (const d of ["2026-11-07", "2026-11-08", "2027-01-01"]) { const i = tipIndex(d, 7); expect(i).toBeGreaterThanOrEqual(0); expect(i).toBeLessThan(7); }
    expect(tipIndex("2026-11-07", 0)).toBe(-1);
  });
});

describe("pastDream", () => {
  const today = "2026-11-15";
  const t = (id: string, date: string, o: Partial<HomeDream> = {}) => dream(id, "n" + id, date, { title: "Dream " + id, ...o });
  const signs = (m: Record<string, PastSign[]>) => new Map(Object.entries(m));

  it("only titled, live dreams at least a week old; none at all gives null", () => {
    expect(pastDream([], today)).toBeNull();
    expect(pastDream([t("1", "2026-11-10"), t("2", "2026-10-01", { title: "  " }), t("3", "2026-10-01", { deletedAt: "x" })], today)).toBeNull();
    expect(pastDream([t("1", "2026-11-08")], today)?.dream.id).toBe("1");
  });

  it("a year or a month ago to the day comes first", () => {
    const d = [t("1", "2025-11-15"), t("2", "2026-10-15"), t("3", "2026-09-01", { lucid: true })];
    expect(pastDream(d, today)).toMatchObject({ dream: { id: "1" }, why: "A year ago today" });
    expect(pastDream(d.slice(1), today)).toMatchObject({ dream: { id: "2" }, why: "A month ago today" });
    // the 31st has no day in a 30-day month: no anniversary, the lucid one instead
    expect(pastDream([t("1", "2026-11-30"), t("3", "2026-09-01", { lucid: true })], "2026-12-31")?.why).toBe("A lucid dream");
  });

  it("prefers this week's target sign, then any dream sign, then a lucid dream", () => {
    const d = [t("1", "2026-09-01", { lucid: true }), t("2", "2026-09-02"), t("3", "2026-09-03"), t("4", "2026-09-04")];
    const s = signs({ "2": [{ id: "e1", name: "school" }], "3": [{ id: "e2", name: "flying" }, { id: "e1", name: "school" }] });
    expect(pastDream(d, today, s, "e2")).toMatchObject({ dream: { id: "3" }, why: "Held this week's dream sign: flying" });
    const any = pastDream(d, today, s);
    expect(["2", "3"]).toContain(any?.dream.id);
    expect(any?.why).toMatch(/^Dream signs?: /);
    expect(pastDream(d, today, new Map())).toMatchObject({ dream: { id: "1" }, why: "A lucid dream" });
    expect(pastDream([t("2", "2026-09-02")], today)?.why).toBe("From your journal");
  });

  it("is the same all day and moves between days", () => {
    const d = Array.from({ length: 20 }, (_, i) => t(String(i).padStart(2, "0"), addDays("2026-08-01", i)));
    expect(pastDream(d, today)?.dream.id).toBe(pastDream([...d].reverse(), today)?.dream.id);
    const ids = new Set(["2026-11-15", "2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19"].map((x) => pastDream(d, x)?.dream.id));
    expect(ids.size).toBeGreaterThan(1);
  });
});
