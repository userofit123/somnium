import { describe, expect, it } from "vitest";
import { outboxItems, withoutSent, type OutboxItem } from "./outbox";

describe("outbox list", () => {
  it("keeps the ids items were stored with", () => {
    const l = outboxItems([{ id: "a", method: "post", path: "/reality-checks", body: { x: 1 }, at: 5 }]);
    expect(l).toEqual([{ id: "a", method: "post", path: "/reality-checks", body: { x: 1 }, at: 5 }]);
  });
  it("gives an item stored before ids the same id in every tab", () => {
    const raw = [{ method: "put", path: "/settings", body: {}, at: 7 }];
    expect(outboxItems(raw)[0]!.id).toBe("7:put:/settings:0");
    expect(outboxItems(JSON.parse(JSON.stringify(raw)))[0]!.id).toBe(outboxItems(raw)[0]!.id);
  });
  it("tells apart two old items with the same time, method and path", () => {
    const raw = [{ method: "put", path: "/settings", body: { a: 1 }, at: 7 }, { method: "put", path: "/settings", body: { b: 1 }, at: 7 }];
    const ids = outboxItems(raw).map((i) => i.id);
    expect(new Set(ids).size).toBe(2);
    expect(withoutSent(outboxItems(raw), ids[0]!).map((i) => i.body)).toEqual([{ b: 1 }]);
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

import { createOutbox, leaseKey, withRowId, LEASE_MS } from "./outbox";

describe("outbox sending", () => {
  const offline = Object.assign(new Error("offline"), { status: 0 });
  const make = (store: Map<string, unknown>, request: (m: string, p: string, b: unknown) => Promise<unknown>, extra: { tab?: string; now?: () => number } = {}) => {
    let n = 0;
    return createOutbox({
      key: () => "list", storage: { read: (k) => store.get(k) ?? null, write: (k, v) => { if (v === null) store.delete(k); else store.set(k, JSON.parse(JSON.stringify(v))); } },
      request, mustWait: (e) => (e as { status?: number }).status === 0, refuseSealed: () => {}, newId: () => `id${++n}`, ...extra,
    });
  };
  it("gives a create its item's id as the row id, and keeps one it has", () => {
    expect(withRowId("post", { a: 1 }, "x")).toEqual({ a: 1, id: "x" });
    expect(withRowId("post", { id: "mine" }, "x")).toEqual({ id: "mine" });
    expect(withRowId("put", { a: 1 }, "x")).toEqual({ a: 1 });
  });
  it("sends a queued create again with the same row id", async () => {
    const store = new Map<string, unknown>();
    const seen: unknown[] = [];
    let up = false;
    const o = make(store, async (_m, _p, b) => { seen.push(b); if (!up) throw offline; return {}; });
    await o.send("post", "/reminders", { kind: "x" });
    const queued = (store.get("list") as OutboxItem[])[0]!;
    expect((queued.body as { id: string }).id).toBe(queued.id);
    up = true;
    await o.flush();
    expect(seen.map((b) => (b as { id: string }).id)).toEqual([queued.id, queued.id]);
    expect(o.list).toEqual([]);
  });
  it("without navigator.locks, only the tab holding the lease sends, until it runs out", async () => {
    const store = new Map<string, unknown>();
    let t = 1000;
    store.set("list", [{ id: "a", method: "put", path: "/x", body: {}, at: 1 }]);
    store.set(leaseKey("list"), { tab: "other", until: t + LEASE_MS });
    const sent: string[] = [];
    const o = make(store, async (_m, p) => { sent.push(p); return {}; }, { tab: "me", now: () => t });
    await o.flush();
    expect(sent).toEqual([]); // another tab is sending
    t += LEASE_MS + 1; // that tab went away mid-send: its lease ran out
    await o.flush();
    expect(sent).toEqual(["/x"]);
    expect(store.has(leaseKey("list"))).toBe(false); // given back when done
  });
});
