import { describe, expect, it } from "vitest";
import { withDefaults, DEFAULT_SETTINGS, HOME_BLOCKS, cleanHomeBlocks } from "./settings";

describe("settings", () => {
  it("gives a new account the defaults, with every optional feature off", () => {
    const s = withDefaults({});
    expect(s).toEqual(DEFAULT_SETTINGS);
    expect(Object.values(s.features).every((on) => on === false)).toBe(true);
  });
  it("keeps saved values and fills in missing ones", () => {
    const s = withDefaults({ firstDay: 0, backup: { keep: 3 }, features: { palette: true } });
    expect(s.firstDay).toBe(0);
    expect(s.backup.keep).toBe(3);
    expect(s.backup.at).toBe("03:00");
    expect(s.features.palette).toBe(true);
    expect(s.clock).toBe("auto");
  });
  it("reads the formats from the language", () => {
    expect(deviceFormats("en-US")).toEqual({ firstDay: 0, dateFormat: "mdy", clock: "12" });
    expect(deviceFormats("de-DE")).toEqual({ firstDay: 1, dateFormat: "dmy", clock: "24" });
    expect(deviceFormats("sv-SE").dateFormat).toBe("ymd");
    const s = resolveFormats(withDefaults({ clock: "12" }), { firstDay: 0, dateFormat: "mdy", clock: "24" });
    expect([s.firstDay, s.dateFormat, s.clock]).toEqual([0, "mdy", "12"]);
  });
  it("gives Home its blocks in the default order", () => {
    expect(withDefaults({}).home.blocks).toEqual(HOME_BLOCKS);
  });
  it("carries the old Features switches for Home's cards over until a layout is saved", () => {
    const s = withDefaults({ features: { homeTip: true, homeSigns: false } });
    expect(s.home.blocks.find((b) => b.id === "tip")?.on).toBe(true);
    expect(s.home.blocks.find((b) => b.id === "signs")?.on).toBe(false);
    // a saved layout wins over the old switches
    const t = withDefaults({ features: { homeTip: true }, home: { blocks: [{ id: "tip", on: false }] } });
    expect(t.home.blocks.find((b) => b.id === "tip")?.on).toBe(false);
  });
  it("keeps ids it doesn't know (a newer device's cards) when cleaning, and Reset's list drops them", () => {
    const out = cleanHomeBlocks([{ id: "rates", on: false }, { id: "newer", on: true }, { id: "newer", on: false }]);
    expect(out.slice(0, 2)).toEqual([{ id: "rates", on: false }, { id: "newer", on: true }]);
    expect(out.filter((b) => b.id === "newer")).toHaveLength(1);
    expect(cleanHomeBlocks(HOME_BLOCKS).some((b) => b.id === "newer")).toBe(false);
  });
  it("cleans a synced layout: repeats dropped, missing ones appended, fixed blocks always on", () => {
    const out = cleanHomeBlocks([{ id: "rates", on: false }, { id: "rates", on: true }, { id: "today", on: false }]);
    expect(out.slice(0, 2)).toEqual([{ id: "rates", on: false }, { id: "today", on: true }]);
    expect(out.map((b) => b.id).sort()).toEqual(HOME_BLOCKS.map((b) => b.id).sort());
  });
});
