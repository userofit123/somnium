import { describe, expect, it } from "vitest";
import { newer } from "./version";

describe("newer", () => {
  it("compares numbers, not text", () => {
    expect(newer("1.10.0", "1.9.2")).toBe(true);
    expect(newer("1.9.2", "1.10.0")).toBe(false);
    expect(newer("1.2.3", "1.2.3")).toBe(false);
  });
  it("ignores a leading v", () => {
    expect(newer("v1.3.1", "1.3.0")).toBe(true);
    expect(newer("v1.3.0", "1.3.0")).toBe(false);
  });
  it("ranks a release above its prereleases", () => {
    expect(newer("1.3.0", "1.3.0-beta.1")).toBe(true);
    expect(newer("1.3.0-beta.1", "1.3.0")).toBe(false);
    expect(newer("1.3.0-beta.2", "1.3.0-beta.1")).toBe(true);
    expect(newer("1.3.0-beta.1", "1.3.0-beta.2")).toBe(false);
    expect(newer("1.3.0-beta.10", "1.3.0-beta.9")).toBe(true);
    expect(newer("1.3.0-rc.1", "1.3.0-beta.5")).toBe(true);
    expect(newer("1.3.0-beta.1", "1.3.0-beta.1")).toBe(false);
    expect(newer("1.3.1-beta.1", "1.3.0")).toBe(true);
  });
});
