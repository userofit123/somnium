import { describe, expect, it } from "vitest";
import { recommend, dismiss, isDismissed, REC, DISMISS_DAYS, RECOMMENDATION_IDS, type RecommendData, type Recommendation } from "./recommend";
import { addDays } from "./rates";
import { MIN_NIGHTS, type InsightNight } from "./insights";

const TODAY = "2026-11-07";
const day = (i: number) => addDays(TODAY, -i); // i days ago
// a night without a dream is logged as "No recall" (a bare one would be a plan, rates.ts isPlanOnly)
const night = (i: number, o: Partial<InsightNight> = {}): InsightNight => ({ id: `n${i}`, date: day(i), dreamCount: 1, noRecall: (o.dreamCount ?? 1) === 0, ...o });
/** `count` nights ending yesterday, all with recall unless told otherwise. */
const nights = (count: number, o: (i: number) => Partial<InsightNight> = () => ({})) => Array.from({ length: count }, (_, k) => night(k + 1, o(k + 1)));
// enough checks to keep the checks rule quiet, unless a test is about it
const manyChecks = Array.from({ length: 7 * 3 }, (_, k) => day(1 + (k % 7)));
const base = (o: Partial<RecommendData> = {}): RecommendData => ({ nights: nights(20), dreams: [], checkDays: manyChecks, reminders: { on: true, perDay: 8 }, ...o });
const ids = (rs: Recommendation[]) => rs.map((r) => r.id);
const all = (d: RecommendData) => recommend(d, TODAY, 99);
const has = (d: RecommendData, id: string) => ids(all(d)).includes(id as never);
// lucid dreams yesterday and the day before keep the MILD + WBTB rule out of tests about something else (two, so it is
// not the first lucid dream either)
const quietLucid = (ns: InsightNight[]) => ns.filter((x) => x.date === day(1) || x.date === day(2)).map((x) => ({ nightId: x.id, lucid: true }));
const lucidOn = (...is: number[]) => is.map((i) => ({ nightId: `n${i}`, lucid: true }));
const leveled = (levels: number[]) => levels.map((l, k) => ({ nightId: `n${k + 1}`, lucid: true, lucidityLevel: l }));
// the new rules' cases (LDJ-114), shared with the wording test below
const firstLucid = () => base({ dreams: lucidOn(3) });
const drySpell = () => base({ nights: nights(40), dreams: lucidOn(30) });
const briefLucid = () => base({ dreams: leveled([1, 1, 3]) });
const mildNight = { techniquesDone: ["mild"] };
const slowMild = (slow: number, quick = 0) => base({ nights: nights(20, (i) => (i <= slow ? { ...mildNight, minutesToSleep: 30 } : i <= slow + quick ? { ...mildNight, minutesToSleep: 5 } : {})), dreams: lucidOn(15, 16) });
const mildWbtb = (count: number, o: Partial<InsightNight> = {}) => nights(20, (i) => (i <= count ? { wbtbUsed: true, techniquesDone: ["mild"], ...o } : {}));

describe("recommend: keep journaling", () => {
  it("shows under 7 logged nights, not at 7; plans and naps don't count", () => {
    const plan = { id: "p", date: day(0), noRecall: false, dreamCount: 0 } as InsightNight;
    const nap = night(2, { id: "nap", nap: true });
    expect(has(base({ nights: [...nights(6), plan, nap] }), "journal")).toBe(true);
    expect(has(base({ nights: nights(7) }), "journal")).toBe(false);
    const r = all(base({ nights: nights(6) })).find((x) => x.id === "journal")!;
    expect(r.reason).toContain("6 nights");
    expect(r.sources).toEqual(["B48", "C30"]);
  });
  it("says so when nothing is logged", () => {
    expect(all(base({ nights: [] })).find((x) => x.id === "journal")!.reason).toContain("Nothing logged yet");
  });
});

describe("recommend: recall first", () => {
  // 10 nights in the last 14 days, `withRecall` of them with a dream, plus older nights with recall
  const mk = (withRecall: number) => [...nights(10, (i) => ({ dreamCount: i <= withRecall ? 1 : 0 })), night(20), night(21)];
  it("under 50% of logged nights in the last 14 days, not at 50%", () => {
    expect(has(base({ nights: mk(4) }), "recall")).toBe(true);
    expect(has(base({ nights: mk(5) }), "recall")).toBe(false);
    const r = all(base({ nights: mk(4) })).find((x) => x.id === "recall")!;
    expect(r.reason).toBe("You remembered a dream on 4 of your 10 logged nights in the last 14 days (40%).");
    expect(r.sources).toContain("B37");
  });
  it("looks at the last 14 days only (day 14 ago is out)", () => {
    const old = Array.from({ length: 10 }, (_, k) => night(14 + k, { dreamCount: 0 }));
    expect(has(base({ nights: [...nights(2), ...old] }), "recall")).toBe(false);
    expect(has(base({ nights: [...nights(2), night(13, { dreamCount: 0 }), night(12, { dreamCount: 0 }), night(11, { dreamCount: 0 }), ...old] }), "recall")).toBe(true);
  });
  it("gives way to keep journaling under 7 nights", () => {
    expect(ids(all(base({ nights: nights(5, () => ({ dreamCount: 0 })) })))).not.toContain("recall");
  });
});

describe("recommend: MILD + WBTB", () => {
  it("recall good, no lucid dream in 3 weeks, no WBTB nights", () => {
    const ns = nights(25);
    expect(has(base({ nights: ns }), "mild-wbtb")).toBe(true);
    const r = all(base({ nights: ns })).find((x) => x.id === "mild-wbtb")!;
    expect(r.action).toEqual({ label: "Plan WBTB", to: "/train/technique/wbtb" });
  });
  it("a lucid dream 20 days ago stops it, 21 days ago doesn't", () => {
    const ns = nights(25);
    expect(has(base({ nights: ns, dreams: [{ nightId: "n20", lucid: true }] }), "mild-wbtb")).toBe(false);
    expect(has(base({ nights: ns, dreams: [{ nightId: "n21", lucid: true }] }), "mild-wbtb")).toBe(true);
    expect(has(base({ nights: nights(25, (i) => (i === 3 ? { lucidCount: 1 } : {})) }), "mild-wbtb")).toBe(false);
  });
  it("a WBTB night in the last 3 weeks stops it; so does poor recall", () => {
    expect(has(base({ nights: nights(25, (i) => (i === 20 ? { wbtbUsed: true } : {})) }), "mild-wbtb")).toBe(false);
    expect(has(base({ nights: nights(25, (i) => (i === 21 ? { wbtbUsed: true } : {})) }), "mild-wbtb")).toBe(true);
    expect(has(base({ nights: nights(25, (i) => ({ dreamCount: i % 3 ? 0 : 1 })) }), "mild-wbtb")).toBe(false);
  });
});

describe("recommend: WBTB works for you", () => {
  // `w` WBTB nights with `wl` lucid, `o` other nights with `ol` lucid
  const mk = (w: number, wl: number, o: number, ol: number): RecommendData => {
    const ns = [...nights(w, () => ({ wbtbUsed: true })), ...Array.from({ length: o }, (_, k) => night(1000 + k))];
    const dreams = [...ns.slice(0, wl), ...ns.slice(w, w + ol)].map((x) => ({ nightId: x.id, lucid: true }));
    return base({ nights: ns, dreams });
  };
  it("at least 10 points higher, with MIN_NIGHTS on both sides", () => {
    expect(has(mk(10, 3, 10, 2), "wbtb-works")).toBe(true); // 30% against 20%: exactly 10 points
    expect(has(mk(100, 29, 100, 20), "wbtb-works")).toBe(false); // 29% against 20%: 9 points
    expect(has(mk(20, 5, 20, 4), "wbtb-works")).toBe(false); // 25% against 20%
    expect(has(mk(MIN_NIGHTS - 1, 5, 10, 0), "wbtb-works")).toBe(false);
    expect(has(mk(10, 5, MIN_NIGHTS - 1, 0), "wbtb-works")).toBe(false);
  });
  it("gives both numbers in the reason", () => {
    expect(all(mk(10, 4, 10, 1)).find((x) => x.id === "wbtb-works")!.reason).toBe("On your 10 WBTB nights you were lucid on 4 (40%); on your 10 other nights, you were lucid on 1 (10%).");
  });
});

describe("recommend: ease off WBTB", () => {
  // 4 weeks: two with 3 WBTB nights rated `busy`, two with none rated `calm`. TODAY is a Saturday.
  const mk = (busyQ: number, calmQ: number, wbtbPerWeek = 3) => {
    const ns: InsightNight[] = [];
    for (let w = 0; w < 4; w++) for (let d = 0; d < 3; d++) {
      const i = w * 7 + d + 1, heavy = w % 2 === 0;
      ns.push(night(i, { sleepQuality: heavy ? busyQ : calmQ, wbtbUsed: heavy && d < wbtbPerWeek }));
    }
    return base({ nights: ns, dreams: quietLucid(ns) });
  };
  it("quality at least 0.5 lower in weeks with 3+ WBTB nights", () => {
    expect(has(mk(3, 3.5), "wbtb-ease")).toBe(true);
    expect(has(mk(3, 3.4), "wbtb-ease")).toBe(false);
    expect(has(mk(2, 4, 2), "wbtb-ease")).toBe(false); // 2 WBTB nights a week is not a busy week
    expect(all(mk(2, 4)).find((x) => x.id === "wbtb-ease")!.reason).toContain("2 out of 5 on average; in other weeks 4");
  });
  it("needs 3 rated nights on each side", () => {
    const d = mk(2, 4);
    const threeRated = { ...d, nights: d.nights.map((x, k) => (x.sleepQuality === 4 && k > 6 ? { ...x, sleepQuality: null } : x)) };
    expect(threeRated.nights.filter((x) => x.sleepQuality === 4).length).toBe(3);
    expect(has(threeRated, "wbtb-ease")).toBe(true);
    const tooFew = { ...d, nights: d.nights.map((x, k) => (x.sleepQuality === 4 && k > 4 ? { ...x, sleepQuality: null } : x)) };
    expect(tooFew.nights.filter((x) => x.sleepQuality === 4).length).toBe(2);
    expect(has(tooFew, "wbtb-ease")).toBe(false);
  });
  it("hides 'WBTB works' while sleep says ease off", () => {
    const d = mk(2, 4);
    const lucidAll = { ...d, nights: [...d.nights, ...Array.from({ length: 20 }, (_, k) => night(200 + k, { wbtbUsed: k < 10 }))] };
    lucidAll.dreams = lucidAll.nights.filter((x) => x.wbtbUsed).map((x) => ({ nightId: x.id, lucid: true }));
    expect(has(lucidAll, "wbtb-ease")).toBe(true);
    expect(has(lucidAll, "wbtb-works")).toBe(false);
  });
});

describe("recommend: reality checks", () => {
  const checks = (count: number) => Array.from({ length: count }, (_, k) => day(1 + (k % 7)));
  it("under 3 a day over the 7 days before today", () => {
    expect(has(base({ checkDays: checks(20) }), "checks")).toBe(true);
    expect(has(base({ checkDays: checks(21) }), "checks")).toBe(false);
    // today's and 8-days-ago checks don't count
    expect(has(base({ checkDays: [...checks(20), day(0), day(0), day(8)] }), "checks")).toBe(true);
  });
  it("with reminders on: raise the count; off: turn them on", () => {
    const on = all(base({ checkDays: checks(7) })).find((x) => x.id === "checks")!;
    expect(on.title).toBe("More reality checks in the day");
    expect(on.reason).toBe("You did 7 reality checks in the last 7 days, about 1 a day, with 8 reminders a day.");
    const off = all(base({ checkDays: [], reminders: { on: false } })).find((x) => x.id === "checks")!;
    expect(off.title).toBe("Turn on reality check reminders");
    expect(off.action).toEqual({ label: "Turn on reminders", to: "/settings/reminders" });
    expect(off.reason).toContain("reminders are off");
  });
});

describe("recommend: false awakenings and nightmares", () => {
  const ns = nights(40);
  const fa = (...is: number[]) => is.map((i) => ({ nightId: `n${i}`, lucid: false, falseAwakening: true }));
  const nm = (...is: number[]) => is.map((i) => ({ nightId: `n${i}`, lucid: false, nightmare: true }));
  it("3 false awakenings in 30 days, counting naps' dreams; 29 days ago is in, 30 is out", () => {
    expect(has(base({ nights: ns, dreams: fa(1, 2, 29) }), "false-awakenings")).toBe(true);
    expect(has(base({ nights: ns, dreams: fa(1, 2, 30) }), "false-awakenings")).toBe(false);
    expect(has(base({ nights: ns, dreams: fa(1, 2) }), "false-awakenings")).toBe(false);
    const nap = night(3, { id: "nap3", nap: true });
    expect(has(base({ nights: [...ns, nap], dreams: [...fa(1, 2), { nightId: "nap3", lucid: false, falseAwakening: true }] }), "false-awakenings")).toBe(true);
    expect(all(base({ nights: ns, dreams: fa(1, 2, 3) })).find((x) => x.id === "false-awakenings")!.body).toContain("\"waking up\"");
  });
  it("2 nightmares in 30 days: the lesson and the safety page", () => {
    expect(has(base({ nights: ns, dreams: nm(1, 29) }), "nightmares")).toBe(true);
    expect(has(base({ nights: ns, dreams: nm(1, 30) }), "nightmares")).toBe(false);
    const r = all(base({ nights: ns, dreams: nm(1, 2) })).find((x) => x.id === "nightmares")!;
    expect(r.action!.to).toBe("/train/lesson/dream-control");
    expect(r.link!.to).toBe("/learn/safety/when-to-stop");
    expect(r.sources).toEqual(expect.arrayContaining(["B61", "C18"]));
    expect(r.reason).toBe("You noted 2 nightmares that woke you in the last 30 days.");
  });
  it("bad dreams (they didn't wake you) never bring it up on their own, but the reason names them", () => {
    const bad = (...is: number[]) => is.map((i) => ({ nightId: `n${i}`, lucid: false, badDream: true }));
    expect(has(base({ nights: ns, dreams: bad(1, 2, 3, 4) }), "nightmares")).toBe(false);
    expect(has(base({ nights: ns, dreams: [...nm(1), ...bad(2, 3)] }), "nightmares")).toBe(false);
    const r = all(base({ nights: ns, dreams: [...nm(1, 2), ...bad(3)] })).find((x) => x.id === "nightmares")!;
    expect(r.reason).toBe("You noted 2 nightmares that woke you, and 1 bad dream that didn't, in the last 30 days.");
  });
});

describe("recommend: the first lucid dream", () => {
  it("one lucid dream in the last 14 days opens the staying-lucid lesson", () => {
    const r = all(firstLucid()).find((x) => x.id === "first-lucid")!;
    expect(r.reason).toBe("You logged your first lucid dream 3 days ago.");
    expect(r.action).toEqual({ label: "Open the lesson", to: "/train/lesson/stabilise" });
    expect(r.sources).toEqual(["D1", "D5"]);
    expect(has(base({ dreams: lucidOn(13) }), "first-lucid")).toBe(true);
    expect(has(base({ dreams: lucidOn(14) }), "first-lucid")).toBe(false);
    expect(has(base({ dreams: lucidOn(3, 10) }), "first-lucid")).toBe(false);
    expect(has(base({ nights: nights(20, (i) => (i === 2 ? { lucidCount: 1 } : {})) }), "first-lucid")).toBe(true);
  });
  it("after the first lucid dream's own moment, the card points on to the lesson without saying it again", () => {
    const r = all({ ...firstLucid(), milestones: { "first-lucid": { on: "2026-11-04", dreamId: "x" } } }).find((x) => x.id === "first-lucid")!;
    expect(r.title).toBe("Staying in your next lucid dream");
    expect(r.body).not.toMatch(/Well done/);
    expect(r.action).toEqual({ label: "Open the lesson", to: "/train/lesson/stabilise" });
  });
  it("not for people who told the setup they have had lucid dreams before", () => {
    expect(has({ ...firstLucid(), experience: "some" }, "first-lucid")).toBe(false);
    expect(has({ ...firstLucid(), experience: "regular" }, "first-lucid")).toBe(false);
    expect(has({ ...firstLucid(), experience: "new" }, "first-lucid")).toBe(true);
  });
});

describe("recommend: a dry spell", () => {
  it("lucid dreams before, none in the last 4 weeks of journaling; it replaces MILD + WBTB", () => {
    const r = all(drySpell()).find((x) => x.id === "dry-spell")!;
    expect(r.reason).toBe("Your last lucid dream was 30 days ago, and you have logged 27 nights in the last 4 weeks.");
    expect(r.sources).toEqual(expect.arrayContaining(["D1", "D5", "D24"]));
    expect(r.link!.to).toBe("/learn/basics/common-mistakes-and-dry-spells");
    expect(r.action!.to).toBe("/train/lesson/troubleshooting");
    expect(has(drySpell(), "mild-wbtb")).toBe(false);
    expect(has(base({ nights: nights(40), dreams: lucidOn(28) }), "dry-spell")).toBe(true);
    expect(has(base({ nights: nights(40), dreams: lucidOn(27) }), "dry-spell")).toBe(false);
  });
  it("needs a journal kept through it, and lucid dreams before it", () => {
    const sparse = [...nights(6), ...Array.from({ length: 10 }, (_, k) => night(30 + k))];
    expect(has(base({ nights: sparse, dreams: lucidOn(35) }), "dry-spell")).toBe(false);
    expect(has(base({ nights: nights(40) }), "dry-spell")).toBe(false);
    expect(has(base({ nights: nights(40) }), "mild-wbtb")).toBe(true);
  });
  it("counts the lucid dreams the setup was told about once the journal is 4 weeks old", () => {
    const r = all(base({ nights: nights(40), experience: "regular" })).find((x) => x.id === "dry-spell")!;
    expect(r.reason).toBe("You said in setup that you have had lucid dreams, and none are logged in the last 4 weeks (27 nights logged).");
    expect(has(base({ nights: nights(40), experience: "some" }), "dry-spell")).toBe(true);
    expect(has(base({ nights: nights(40), experience: "new" }), "dry-spell")).toBe(false);
    expect(has(base({ nights: nights(20), experience: "regular" }), "dry-spell")).toBe(false);
  });
});

describe("recommend: brief lucidity", () => {
  it("over half of 3+ rated lucid dreams in 60 days at level 1", () => {
    const r = all(briefLucid()).find((x) => x.id === "stabilise")!;
    expect(r.reason).toBe("2 of your 3 rated lucid dreams in the last 60 days were a brief flash, lost at once.");
    expect(r.action!.to).toBe("/train/lesson/stabilise");
    expect(has(base({ dreams: leveled([1, 3, 3]) }), "stabilise")).toBe(false);
    expect(has(base({ dreams: leveled([1, 1]) }), "stabilise")).toBe(false);
    expect(has(base({ dreams: leveled([1, 1, 2, 3]) }), "stabilise")).toBe(false);
    // unrated lucid dreams don't count either way
    expect(has(base({ dreams: [...leveled([1, 1, 3]), ...lucidOn(5, 6, 7)] }), "stabilise")).toBe(true);
  });
  it("only the last 60 days", () => {
    const ns = nights(70);
    const at = (i: number, l: number) => ({ nightId: `n${i}`, lucid: true, lucidityLevel: l });
    expect(has(base({ nights: ns, dreams: [at(1, 1), at(59, 1), at(2, 3)] }), "stabilise")).toBe(true);
    expect(has(base({ nights: ns, dreams: [at(1, 1), at(60, 1), at(2, 3)] }), "stabilise")).toBe(false);
  });
  it("not in a dry spell: brief lucid dreams 28-60 days ago and none since", () => {
    const ns = nights(70);
    const at = (i: number) => ({ nightId: `n${i}`, lucid: true, lucidityLevel: 1 });
    const d = base({ nights: ns, dreams: [at(28), at(40), at(55)] });
    expect(has(d, "dry-spell")).toBe(true);
    expect(has(d, "stabilise")).toBe(false);
  });
});

describe("recommend: slow to sleep after MILD", () => {
  it("over half of 3+ timed MILD nights in 30 days took more than 20 minutes", () => {
    const r = all(slowMild(3, 1)).find((x) => x.id === "mild-sleep")!;
    expect(r.reason).toBe("On 3 of your 4 MILD nights in the last 30 days it took you more than 20 minutes to fall asleep.");
    expect(r.sources).toEqual(expect.arrayContaining(["B38", "B37"]));
    expect(has(slowMild(2, 2), "mild-sleep")).toBe(false);
    expect(has(slowMild(2), "mild-sleep")).toBe(false);
    const exactly20 = base({ nights: nights(20, (i) => (i <= 3 ? { ...mildNight, minutesToSleep: i === 1 ? 20 : 30 } : {})) });
    expect(has(exactly20, "mild-sleep")).toBe(true);
    const at20 = base({ nights: nights(20, (i) => (i <= 3 ? { ...mildNight, minutesToSleep: i === 1 ? 30 : "20" } : {})) });
    expect(has(at20, "mild-sleep")).toBe(false);
  });
  it("only MILD nights count", () => {
    expect(has(base({ nights: nights(20, (i) => (i <= 3 ? { minutesToSleep: 40 } : {})) }), "mild-sleep")).toBe(false);
  });
});

describe("recommend: try SSILD", () => {
  it("8 MILD + WBTB nights since the last lucid dream, in 6 weeks", () => {
    const r = all(base({ nights: mildWbtb(8) })).find((x) => x.id === "try-ssild")!;
    expect(r.reason).toBe("You have done MILD with WBTB on 8 nights in the last 6 weeks without a lucid dream.");
    expect(r.sources).toEqual(expect.arrayContaining(["B38", "D19"]));
    expect(r.action!.to).toBe("/train/technique/ssild");
    expect(has(base({ nights: mildWbtb(7) }), "try-ssild")).toBe(false);
    expect(has(base({ nights: mildWbtb(10), dreams: lucidOn(5) }), "try-ssild")).toBe(false);
    expect(all(base({ nights: mildWbtb(10), dreams: lucidOn(9) })).find((x) => x.id === "try-ssild")!.reason).toContain("on 8 nights in the last 6 weeks without a lucid dream since your last one");
  });
  it("not once SSILD is in use, not after sleep first, not on MILD alone", () => {
    expect(has(base({ nights: mildWbtb(8, { techniquesDone: ["mild", "ssild"] }) }), "try-ssild")).toBe(false);
    expect(has(base({ nights: mildWbtb(8), sleepFirst: true }), "try-ssild")).toBe(false);
    expect(has(base({ nights: nights(20, (i) => (i <= 8 ? mildNight : {})) }), "try-ssild")).toBe(false);
  });
  it("not in a dry spell, even with many MILD + WBTB nights: the dry spell's card says to rest first", () => {
    const d = base({ nights: nights(40, (i) => (i <= 12 ? { wbtbUsed: true, techniquesDone: ["mild"] } : {})), dreams: lucidOn(30) });
    expect(has(d, "dry-spell")).toBe(true);
    expect(has(d, "try-ssild")).toBe(false);
  });
});

describe("recommend: the setup's experience answer", () => {
  it("a regular lucid dreamer is not told to keep a journal; recall still comes up from their numbers", () => {
    expect(has(base({ nights: nights(3), experience: "regular" }), "journal")).toBe(false);
    expect(has(base({ nights: nights(3), experience: "some" }), "journal")).toBe(true);
    expect(has(base({ nights: nights(3) }), "journal")).toBe(true);
    expect(has(base({ nights: nights(3, () => ({ dreamCount: 0 })), experience: "regular" }), "recall")).toBe(false);
    expect(has(base({ nights: nights(10, () => ({ dreamCount: 0 })), experience: "regular" }), "recall")).toBe(true);
  });
});

describe("recommend: order, the cap and dismissals", () => {
  // everything at once: few checks, nightmares, false awakenings, under 7 nights
  const busy = (): RecommendData => {
    const ns = nights(5, () => ({ dreamCount: 0 }));
    const dreams = ns.flatMap((x) => [{ nightId: x.id, lucid: false, nightmare: true, falseAwakening: true }]);
    return base({ nights: ns, dreams, checkDays: [] });
  };
  it("at most 3, most important first", () => {
    expect(all(busy()).length).toBe(4);
    expect(ids(recommend(busy(), TODAY))).toEqual(["nightmares", "journal", "false-awakenings"]);
  });
  it("a dismissed one stays away for 14 days and comes back on the 14th", () => {
    const d = { ...busy(), dismissed: dismiss([], "nightmares", day(13)) };
    expect(ids(recommend(d, TODAY))).toEqual(["journal", "false-awakenings", "checks"]);
    expect(ids(recommend({ ...d, dismissed: [{ id: "nightmares", on: day(DISMISS_DAYS) }] }, TODAY))[0]).toBe("nightmares");
    expect(isDismissed("x", [{ id: "x", on: TODAY }], TODAY)).toBe(true);
    expect(isDismissed("x", [{ id: "x", on: TODAY }], addDays(TODAY, 13))).toBe(true);
    expect(isDismissed("x", [{ id: "x", on: TODAY }], addDays(TODAY, 14))).toBe(false);
  });
  it("dismissing drops expired entries and replaces the same id", () => {
    const list = [{ id: "old", on: day(20) }, { id: "keep", on: day(2) }, { id: "checks", on: day(5) }];
    expect(dismiss(list, "checks", TODAY)).toEqual([{ id: "keep", on: day(2) }, { id: "checks", on: TODAY }]);
  });
  it("shows nothing when nothing applies", () => {
    const ns = nights(20);
    expect(recommend(base({ nights: ns, dreams: quietLucid(ns) }), TODAY)).toEqual([]);
  });
});

describe("recommend: never a substance, plain wording", () => {
  const SUBSTANCES = /galantamine|choline|melatonin|nicotine|cannabis|alcohol|\bB6\b|vitamin|supplement/i;
  it("no output names a substance, says 'caused' or uses a long dash", () => {
    const ns = [...nights(30, (i) => ({ wbtbUsed: i <= 10, sleepQuality: i <= 10 ? 2 : 4, dreamCount: i % 5 ? 1 : 0, alcohol: true, substances: "galantamine" }))];
    const dreams = ns.map((x, k) => ({ nightId: x.id, lucid: k % 2 === 1, nightmare: true, falseAwakening: true }));
    const cases: RecommendData[] = [
      base({ nights: ns, dreams, checkDays: [] }), base({ nights: [], checkDays: [], reminders: { on: false } }),
      base({ nights: nights(25) }), base({ nights: nights(14, (i) => ({ dreamCount: i % 4 ? 0 : 1 })) }),
      base({ nights: nights(30, (i) => ({ wbtbUsed: i % 2 === 0 })), dreams: nights(30).filter((_, k) => k % 2 === 1).map((x) => ({ nightId: x.id, lucid: true })) }),
      firstLucid(), drySpell(), base({ nights: nights(40), experience: "regular" }), briefLucid(), slowMild(3), base({ nights: mildWbtb(8) }),
      base({ safetyPage: "sleep-first" }), base({ safetyPage: "who-should-be-careful" }),
    ];
    const out = cases.flatMap((c) => all(c));
    expect([...new Set(out.map((r) => r.id))].sort()).toEqual([...RECOMMENDATION_IDS].sort());
    for (const r of out) {
      const text = [r.title, r.body, r.reason, r.action?.label ?? "", r.link?.label ?? ""].join(" ");
      expect(text).not.toMatch(SUBSTANCES);
      expect(text).not.toMatch(/\bcaused?\b|[–—]/);
      expect(r.sources.length).toBeGreaterThan(0);
      for (const s of r.sources) expect(s).toMatch(/^[A-D]\d+$/);
    }
  });
  it("thresholds are the ones in PLAN.md §8.2", () => {
    expect(REC).toMatchObject({ journalNights: 7, recallRate: 0.5, recallDays: 14, noLucidDays: 21, wbtbLead: 0.1, easeWbtb: 3, checksPerDay: 3, checkDays: 7, faCount: 3, faDays: 30, nmCount: 2 });
  });
});

describe("recommend: the safety check (LDJ-116)", () => {
  it("sleep first leaves out MILD + WBTB and WBTB works", () => {
    const ns = nights(25);
    expect(has(base({ nights: ns, sleepFirst: true }), "mild-wbtb")).toBe(false);
    const ws = [...nights(10, () => ({ wbtbUsed: true })), ...Array.from({ length: 10 }, (_, k) => night(1000 + k))];
    const dreams = [...ws.slice(0, 5)].map((x) => ({ nightId: x.id, lucid: true }));
    expect(has(base({ nights: ws, dreams }), "wbtb-works")).toBe(true);
    expect(has(base({ nights: ws, dreams, sleepFirst: true }), "wbtb-works")).toBe(false);
  });
  it("nothing it shows points at WBTB, the CAT alarm or naps", () => {
    for (const r of all(base({ nights: nights(25), sleepFirst: true }))) expect(r.action?.to ?? "").not.toMatch(/wbtb|cat|nap/);
  });
  it("the page it asked for comes first, with its sources and link", () => {
    const r = all(base({ safetyPage: "who-should-be-careful" }))[0]!;
    expect(r.id).toBe("safety");
    expect(r.link?.to).toBe("/learn/safety/who-should-be-careful");
    expect(r.sources.length).toBeGreaterThan(0);
    expect(all(base({ safetyPage: "sleep-first" }))[0]!.link?.to).toBe("/learn/safety/sleep-first");
    expect(has(base(), "safety")).toBe(false);
  });
});
