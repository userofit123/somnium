// The outbox (packages/shared/src/outbox.ts) wired to the real sealed-column check, and the server side of its
// resends: a create sent again with its id answers the row it made instead of 409 (rows.ts sameCreate).
import { describe, it, expect, beforeAll } from "vitest";
import { createOutbox, type OutboxItem } from "@somnium/shared";
import { createEngine, type Engine } from "../src/index";
import { pgliteDb } from "../src/adapters/pglite";
import { uuidv7 } from "../src/ids";
import { plaintextSealedFields, refuseSealedInClear } from "../src/sync/sealedApi";

const offline = Object.assign(new Error("offline"), { status: 0 });
function box(request: (m: string, p: string, b: unknown) => Promise<unknown>) {
  const store = new Map<string, unknown>();
  const o = createOutbox({
    key: () => "list", storage: { read: (k) => store.get(k) ?? null, write: (k, v) => { store.set(k, v); } },
    request, mustWait: (e) => (e as { status?: number }).status === 0, refuseSealed: refuseSealedInClear, newId: uuidv7,
  });
  return { o, store };
}

describe("the outbox never keeps a sealed field in the clear", () => {
  it("finds the sealed columns a body carries", () => {
    expect(plaintextSealedFields("put", "/reality-checks/x", { note: "I looked at my hands" })).toEqual(["note"]);
    expect(plaintextSealedFields("post", "/practice", { item: "mild", note: "x" })).toEqual(["note"]);
    expect(plaintextSealedFields("put", "/course/l1", { state: "done", answers: "{}" })).toEqual(["answers"]);
    expect(plaintextSealedFields("put", "/dreams/x", { favourite: true })).toEqual([]);
    expect(plaintextSealedFields("put", "/reality-checks/x", { note: null })).toEqual([]);
    expect(plaintextSealedFields("post", "/reminders", { kind: "reality_check" })).toEqual([]);
    // what the screens queue offline (LDJ-189, LDJ-190): a settings patch, a dream sign mark, a confirmed element
    expect(plaintextSealedFields("put", "/settings", { features: { wbtb: true } })).toEqual([]);
    expect(plaintextSealedFields("put", "/elements/x", { isDreamSign: true })).toEqual([]);
    expect(plaintextSealedFields("put", "/elements/x", { confirmed: true })).toEqual([]);
    expect(plaintextSealedFields("put", "/elements/x", { name: "teeth", note: "x" })).toEqual(["name", "note"]);
  });
  it("send() with a sealed field in the clear throws, online or not, and stores nothing", async () => {
    let sent = 0;
    const { o, store } = box(async () => { sent++; throw offline; });
    await expect(o.send("put", "/reality-checks/x", { note: "a dream sign" })).rejects.toThrow(/sealed/);
    const online = box(async () => { sent++; return {}; });
    await expect(online.o.send("post", "/nights", { date: "2026-01-01", notes: "text" })).rejects.toThrow(/sealed/);
    expect(sent).toBe(0);
    expect(JSON.stringify([...store.values()])).not.toContain("dream sign");
  });
  it("still queues what has nothing sealed in it", async () => {
    const { o, store } = box(async () => { throw offline; });
    expect(await o.send("put", "/reality-checks/x", { note: null })).toBeNull();
    expect((store.get("list") as OutboxItem[]).length).toBe(1);
  });
});

let eng: Engine;
let A: string, B: string;
const handle = (user: string, method: string, path: string, body?: unknown) => eng.handle({ method, path, body, userId: user });

beforeAll(async () => {
  eng = await createEngine(await pgliteDb("memory://"), { mode: "server" });
  A = uuidv7(); B = uuidv7();
  await eng.db.admin.query("INSERT INTO users (id, username, display_name) VALUES ($1,'a','A'), ($2,'b','B')", [A, B]);
}, 120000);

describe("a create sent again", () => {
  const cases: [string, string, () => Record<string, unknown>][] = [
    ["reminders", "/reminders", () => ({ kind: "reality_check", enabled: true, schedule: { every: 90, seed: 3, from: "09:00" } })],
    ["practice", "/practice", () => ({ date: "2026-03-01", item: "mild", done: true })],
    ["checks", "/reality-checks", () => ({ at: "2026-03-01T10:00:00.000Z", kind: "hands", outcome: "awake", prompted: false })],
    ["nights", "/nights", () => ({ date: "2026-03-02", noRecall: true })],
  ];
  for (const [what, path, body] of cases) {
    it(`answers the row it made for ${what}, and 409 for different content`, async () => {
      const id = uuidv7();
      const first = await handle(A, "POST", path, { ...body(), id });
      expect(first.status).toBe(200);
      const seen: string[][] = [];
      const off = eng.onChange((_u, t) => seen.push(t));
      const again = await handle(A, "POST", path, { ...body(), id });
      off();
      expect(again.status).toBe(200);
      expect((again.body as any).id).toBe(id);
      expect(seen).toEqual([]); // nothing new to announce
      const changed = { ...body(), id, ...(what === "nights" ? { noRecall: false } : what === "reminders" ? { enabled: false } : what === "practice" ? { done: false } : { outcome: "dreaming" }) };
      expect((await handle(A, "POST", path, changed)).status).toBe(409);
      // another person's id is never answered with this person's row
      expect((await handle(B, "POST", path, { ...body(), id })).status).not.toBe(200);
    });
  }
  it("course: the same lesson sent twice is one row", async () => {
    const id = uuidv7();
    expect((await handle(A, "PUT", "/course/l-1", { id, state: "active", startedAt: "2026-03-01T10:00:00.000Z" })).status).toBe(200);
    expect((await handle(A, "PUT", "/course/l-1", { id, state: "active", startedAt: "2026-03-01T10:00:00.000Z" })).status).toBe(200);
    const list = (await handle(A, "GET", "/course")).body as any[];
    expect(list.filter((l) => l.lessonId === "l-1").length).toBe(1);
  });
  it("the outbox resending after a lost answer leaves one row", async () => {
    let lost = true;
    const { o } = box(async (m, p, b) => {
      const r = await handle(A, m.toUpperCase().replace("DEL", "DELETE"), p, b);
      if (lost) { lost = false; throw offline; } // the server made it, the answer never came back
      if (r.status !== 200) throw Object.assign(new Error(String(r.status)), { status: r.status });
      return r.body;
    });
    expect(await o.send("post", "/practice", { date: "2026-04-01", item: "wbtb", done: true })).toBeNull();
    await o.flush();
    expect(o.list).toEqual([]);
    const rows = ((await handle(A, "GET", "/practice", undefined)).body as any[]).filter((r) => r.date === "2026-04-01");
    expect(rows.length).toBe(1);
  });
  // apps/web/src/api/train.ts changeNight: tonight's plan made with no connection is a night create with the id
  // ensureNight asked for, then the plan; the create may already have reached the server before the connection went
  it("tonight's plan queued offline lands on one night, also when its create reached the server first", async () => {
    let up = false;
    const { o } = box(async (m, p, b) => {
      if (!up) throw offline;
      const r = await handle(A, m.toUpperCase().replace("DEL", "DELETE"), p, b);
      if (r.status !== 200) throw Object.assign(new Error(String(r.status)), { status: r.status });
      return r.body;
    });
    const id = uuidv7(), date = "2026-04-02";
    expect((await handle(A, "POST", "/nights", { id, date, nap: false })).status).toBe(200); // ensureNight's own create
    expect(await o.send("post", "/nights", { id, date, nap: false })).toBeNull();
    expect(await o.send("put", `/nights/${id}`, { techniquesPlanned: ["mild", "wbtb"], wbtbWakeAt: "2026-04-02T03:30:00.000Z", wbtbMode: "short" })).toBeNull();
    up = true;
    // the second send started a flush of its own (that failed offline): wait for it, as api/outbox.ts settle() does
    while (o.flushing) await new Promise((ok) => setTimeout(ok, 10));
    await o.flush();
    expect(o.list).toEqual([]);
    const nights = ((await handle(A, "GET", "/nights", undefined)).body as any[]).filter((n) => n.date === date);
    expect(nights.map((n) => [n.id, n.techniquesPlanned, n.wbtbMode])).toEqual([[id, ["mild", "wbtb"], "short"]]);
  });
});
