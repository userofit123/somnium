import { describe, expect, it } from "vitest";
import { withDefaults, DEFAULT_SETTINGS } from "./settings";

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
    expect(s.clock).toBe("24");
  });
});
