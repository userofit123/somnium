import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ATM, pairs, ratio } from "./contrast";

// WCAG: every colour set, both modes, must keep its text readable (LDJ-44, LDJ-60). A new set that fails breaks this.
describe("contrast of every colour set", () => {
  for (const name of Object.keys(ATM)) {
    it(name, () => {
      const bad = pairs(name).filter((p) => p.ratio < p.need).map((p) => `${p.mode} ${p.token}/${p.on} ${p.ratio.toFixed(2)}`);
      expect(bad).toEqual([]);
    });
  }
  it("night-dim tokens", () => {
    const css = readFileSync(new URL("../../../apps/web/src/styles/tokens.css", import.meta.url), "utf8");
    const tok = (n: string) => new RegExp("--" + n + ":\\s*(#\\w+)").exec(css)![1]!;
    for (const s of ["sdim", "sdim2"]) {
      expect(ratio(tok("sdimtx"), tok(s))).toBeGreaterThanOrEqual(4.5);
      expect(ratio(tok("sdimtx2"), tok(s))).toBeGreaterThanOrEqual(3);
    }
  });
});
