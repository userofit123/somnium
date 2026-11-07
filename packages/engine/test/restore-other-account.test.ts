// LDJ-62: a backup or export restored into another account. Under the ids it had there, every row was refused by the
// server's row-level security and the device dropped the refusals. Now the rows get ids of their own in the new
// account (rekey.ts), links between them kept and sealed values bound to the new ids; and a change the server refuses
// stays in the device's log to be tried again.
import { describe, it, expect, beforeAll } from "vitest";
import { newDataKey } from "@somnium/shared";
import { createEngine, replica, sealRequest, openResponse, type Engine } from "../src/index";
import { pgliteDb } from "../src/adapters/pglite";
import { uuidv7 } from "../src/ids";
import { rekeyForAccount, fromOtherAccount } from "../src/sync/rekey";

const KEY_A = newDataKey(), KEY_B = newDataKey();
let server: Engine, A: string, B: string;
const call = async (e: Engine, user: string, method: string, path: string, body?: unknown, query?: Record<string, string>) => {
  const r = await e.handle({ method, path, body, query, userId: user });
  if (r.status !== 200) throw Object.assign(new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`), { status: r.status });
  return r.body as any;
};
const noLookup = async () => { throw new Error("no lookup in a restore"); };

// a journal as a device exports it: in the clear, owned by A
const n1 = uuidv7(), d1 = uuidv7(), e1 = uuidv7(), l1 = uuidv7(), merged = uuidv7();
const fileOfA = () => ({
  app: "somnium", format: 1, sealed: false, user: { id: A, username: "a" }, settings: {},
  tables: {
    nights: [{ id: n1, date: "2026-10-01", nap: false, notes: "Slept late" }],
    dreams: [{ id: d1, night_id: n1, title: "Harbour", text: "Flying over the harbour", position: 0 }],
    elements: [{ id: e1, kind: "place", name: "Harbour" }],
    dream_elements: [{ id: l1, dream_id: d1, element_id: e1, span: "harbour" }],
  },
});
async function opened(user: string, key: Uint8Array) {
  const out = await openResponse("/export", await call(server, user, "GET", "/export"), key);
  expect(out.unopened).toBe(0);
  return (out.data as any).tables;
}

beforeAll(async () => {
  server = await createEngine(await pgliteDb("memory://"), { mode: "server" });
  A = uuidv7(); B = uuidv7();
  await server.db.admin.query("INSERT INTO users (id, username, display_name) VALUES ($1,'a','A'), ($2,'b','B')", [A, B]);
  await call(server, A, "POST", "/import", await sealRequest("POST", "/import", { data: fileOfA(), mode: "merge" }, KEY_A, noLookup));
}, 120000);

describe("restoring into another account", () => {
  it("tells another account's file from this account's", () => {
    expect(fromOtherAccount(fileOfA(), { id: A })).toBe(false);
    expect(fromOtherAccount(fileOfA(), { id: B })).toBe(true);
    // an older file names its owner only by user name
    expect(fromOtherAccount({ user: { username: "a" } }, { id: B, username: "b" })).toBe(true);
    expect(fromOtherAccount({ user: { username: "A" } }, { id: A, username: "a" })).toBe(false);
    expect(fromOtherAccount({}, { id: B, username: "b" })).toBe(false);
  });

  it("gives the rows ids of their own, keeps their links, and seals them under the new ids", async () => {
    const forB = await rekeyForAccount(fileOfA(), { id: B, username: "b" });
    const body = await sealRequest("POST", "/import", { data: forB, mode: "merge" }, KEY_B, noLookup);
    const counts = await call(server, B, "POST", "/import", body);
    expect(counts).toMatchObject({ nights: 1, dreams: 1, elements: 1, dream_elements: 1 });
    const t = await opened(B, KEY_B);
    const [night, dream, element, link] = [t.nights[0], t.dreams[0], t.elements[0], t.dream_elements[0]];
    expect([night.id, dream.id, element.id, link.id]).not.toContain(n1);
    expect(new Set([night.id, dream.id, element.id, link.id, n1, d1, e1, l1]).size).toBe(8);
    expect(dream.night_id).toBe(night.id);
    expect(link).toMatchObject({ dream_id: dream.id, element_id: element.id, span: "harbour" });
    expect(dream.text).toBe("Flying over the harbour");
    expect(night.notes).toBe("Slept late");
    // the time part of the old id stays, so the rows keep their order
    expect(dream.id.slice(0, 13)).toBe(d1.slice(0, 13));
    // A's journal is as it was
    const a = await opened(A, KEY_A);
    expect(a.dreams.map((d: any) => d.id)).toEqual([d1]);
  });

  it("lands on the same rows when the same file is merged again", async () => {
    const forB = await rekeyForAccount(fileOfA(), { id: B, username: "b" });
    await call(server, B, "POST", "/import", await sealRequest("POST", "/import", { data: forB, mode: "merge" }, KEY_B, noLookup));
    expect((await opened(B, KEY_B)).dreams).toHaveLength(1);
  });

  it("refuses a sealed file of another account rather than losing its rows one by one", async () => {
    const body = await sealRequest("POST", "/import", { data: fileOfA(), mode: "merge" }, KEY_B, noLookup);
    const r = await server.handle({ method: "POST", path: "/import", body, userId: B });
    expect(r.status).toBe(400);
  });
});

describe("a device's copy", () => {
  let device: Engine, deviceId = "", C = "";
  const push = async () => {
    const out = await replica.localChanges(device.db, 500, KEY_B);
    const res = await call(server, C, "POST", "/sync/push", { device: deviceId, changes: out.changes });
    await replica.markSent(device.db, out.upTo, res.failed);
    return res;
  };
  beforeAll(async () => {
    // C: a fresh account, so the device's restore is the only thing in it
    C = uuidv7();
    await server.db.admin.query("INSERT INTO users (id, username, display_name) VALUES ($1,'c','C')", [C]);
    device = await createEngine(await pgliteDb("memory://"), { mode: "local", seed: false });
    deviceId = (await replica.loadSnapshot(device.db, await call(server, C, "GET", "/sync/snapshot"), KEY_B)).device;
  }, 120000);

  it("restores another account's file under new ids, and the server takes every row", async () => {
    await call(device, C, "POST", "/import", { data: fileOfA(), mode: "merge" });
    const res = await push();
    expect(res.failed).toEqual([]);
    expect(await replica.waitingCount(device.db)).toBe(0);
    const t = await opened(C, KEY_B);
    expect(t.dreams).toHaveLength(1);
    expect(t.dreams[0].id).not.toBe(d1);
    expect(t.dreams[0].text).toBe("Flying over the harbour");
  });

  it("keeps a change the server refuses, and sends it again on the next sync", async () => {
    // a row under one of A's ids, as a restore before LDJ-62 left it: row-level security refuses it on the server
    const file = { ...fileOfA(), user: { id: C }, tables: { ...fileOfA().tables, nights: [{ id: n1, date: "2026-10-09", nap: false }], dreams: [], elements: [], dream_elements: [] } };
    await call(device, C, "POST", "/import", { data: file, mode: "merge" });
    const res = await push();
    expect(res.failed.map((f: any) => f.pk.id)).toEqual([n1]);
    expect(await replica.waitingCount(device.db)).toBe(1);
    // nothing else in line: the refused change waits behind the sent position until the next sync puts it back
    expect((await replica.localChanges(device.db, 500, KEY_B)).changes).toEqual([]);
    await replica.requeueRefused(device.db);
    const again = await replica.localChanges(device.db, 500, KEY_B);
    expect(again.changes.map((c) => c.pk.id)).toEqual([n1]);
    expect(await replica.waitingCount(device.db)).toBe(1);
  });
});
