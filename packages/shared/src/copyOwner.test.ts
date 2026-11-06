import { describe, expect, it } from "vitest";
import { copyDecision, leftByOthers } from "./copyOwner";

describe("whose copy a tab may work on", () => {
  it("closes the copy when the session ends (a 401), so the transport leaves it", () => {
    expect(copyDecision("ann", null)).toEqual({ stop: true, start: false });
  });
  it("never lets a different person sign in on someone else's open copy", () => {
    expect(copyDecision("ann", "bob")).toEqual({ stop: true, start: true });
  });
  it("keeps the copy for the same person", () => {
    expect(copyDecision("ann", "ann")).toEqual({ stop: false, start: true });
  });
  it("opens a copy when none is open, and does nothing with nobody signed in", () => {
    expect(copyDecision(null, "bob")).toEqual({ stop: false, start: true });
    expect(copyDecision(null, null)).toEqual({ stop: false, start: false });
  });

  it("finds what others left on this server, and leaves this person's and other servers' alone", () => {
    const names = ["/pglite/somnium-r-x-ann", "/pglite/somnium-r-x-bob", "/pglite/somnium-r-y-ann", "/pglite/other"];
    expect(leftByOthers(names, "/pglite/somnium-r-x-", "bob")).toEqual(["/pglite/somnium-r-x-ann"]);
    expect(leftByOthers(names, "/pglite/somnium-r-x-", "ann")).toEqual(["/pglite/somnium-r-x-bob"]);
    expect(leftByOthers(["/pglite/somnium-r-x-ann"], "/pglite/somnium-r-x-", "ann")).toEqual([]);
  });
});
