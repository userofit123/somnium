import { describe, expect, it } from "vitest";
import { outboxItems, withoutSent } from "./outbox";

describe("outbox list", () => {
  it("keeps the ids items were stored with", () => {
    const l = outboxItems([{ id: "a", method: "post", path: "/reality-checks", body: { x: 1 }, at: 5 }]);
    expect(l).toEqual([{ id: "a", method: "post", path: "/reality-checks", body: { x: 1 }, at: 5 }]);
  });
  it("gives an item stored before ids the same id in every tab", () => {
    const raw = [{ method: "put", path: "/settings", body: {}, at: 7 }];
    expect(outboxItems(raw)[0]!.id).toBe("7:put:/settings");
    expect(outboxItems(JSON.parse(JSON.stringify(raw)))[0]!.id).toBe(outboxItems(raw)[0]!.id);
  });
  it("drops what isn't a change and reads anything else as empty", () => {
    expect(outboxItems(null)).toEqual([]);
    expect(outboxItems("x")).toEqual([]);
    expect(outboxItems([null, { method: "get", path: "/x" }, { method: "del" }, { method: "del", path: "/nights/1", at: 1 }]).map((i) => i.path)).toEqual(["/nights/1"]);
  });
  it("removes the sent item by id, whatever another tab did to the list meanwhile", () => {
    const sent = { id: "1", method: "post" as const, path: "/a", at: 1 };
    // another tab queued two more after it and sent nothing: only the sent one goes
    const now = [sent, { id: "2", method: "post" as const, path: "/b", at: 2 }, { id: "3", method: "put" as const, path: "/c", at: 3 }];
    expect(withoutSent(now, "1").map((i) => i.id)).toEqual(["2", "3"]);
    // another tab already sent it: nothing else is touched
    expect(withoutSent(now.slice(1), "1").map((i) => i.id)).toEqual(["2", "3"]);
  });
});
