import { describe, expect, it } from "vitest";
import { recallBaseline } from "./assessments";

describe("recallBaseline", () => {
  it("turns the setup's MADRE answer into dreams a night with its label", () => {
    expect(recallBaseline(4)).toEqual({ perNight: 1 / 7, label: "About once a week" });
    expect(recallBaseline(6)?.perNight).toBeCloseTo(6.5 / 7);
    expect(recallBaseline(0)).toEqual({ perNight: 0, label: "Never" });
  });
  it("is null when nothing was answered", () => {
    expect(recallBaseline(null)).toBeNull();
    expect(recallBaseline(undefined)).toBeNull();
    expect(recallBaseline(42)).toBeNull();
  });
});
