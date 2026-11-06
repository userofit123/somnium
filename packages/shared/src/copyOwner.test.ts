import { describe, expect, it } from "vitest";
import { copyDecision, leftByOthers, leftWithNothingUnsent, ownRecord, unlockRecordName, unlockRecordsToForget } from "./copyOwner";

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

describe("what opens a journal on this device", () => {
  const PLACE = "https://a.example", other = "https://a.example:8443";
  const name = (id: string, place = PLACE) => unlockRecordName("somniumDeviceUnlock", place, id);

  it("keeps each person's record under their own name", () => {
    expect(name("ann")).not.toBe(name("bob"));
  });
  it("offers a record only to the person it belongs to", () => {
    const ann = { owner: "ann", cred: {} };
    expect(ownRecord(ann, "ann")).toBe(ann);
    expect(ownRecord(ann, "bob")).toBeNull();
    expect(ownRecord(ann, null)).toBeNull();
  });
  it("offers a record with no owner to nobody", () => {
    expect(ownRecord<{ owner?: string; cred?: object }>({ cred: {} }, "ann")).toBeNull();
    expect(ownRecord(null, "ann")).toBeNull();
  });
  it("forgets what others left on this server, older unowned records too, and nothing else", () => {
    const stored = [name("ann"), name("bob"), "somniumDeviceUnlock:" + PLACE, name("cid", other), "somniumUnlock:" + PLACE + "#bob", "somniumTheme"];
    expect(unlockRecordsToForget(stored, "somniumDeviceUnlock", PLACE, "ann")).toEqual([name("bob"), "somniumDeviceUnlock:" + PLACE]);
  });
});

describe("a copy someone else left on this device", () => {
  const notes: Record<string, string> = { clean: "0", waiting: "3", unknown: "" };
  it("may go only when it is known to hold nothing unsent", () => {
    expect(leftWithNothingUnsent(["clean", "waiting", "unknown"], (n) => notes[n]!)).toEqual(["clean"]);
  });
});
