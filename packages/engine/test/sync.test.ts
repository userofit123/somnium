// Offline use: a device works on its own copy of a server account and syncs both ways; the newest change wins.
import { describe, it, expect, beforeAll } from "vitest";
import { createEngine, replica, type Engine } from "../src/index";
import { pgliteDb } from "../src/adapters/pglite";
import { uuidv7 } from "../src/ids";
import { newDataKey, isSealed, sealColumn } from "@somnium/shared";

// the account's data key: sealed tables leave the device sealed under it and come back opened (sealing.test.ts checks that)
const KEY = newDataKey();
let server: Engine, device: Engine, U: string, deviceId = "";
const on = (e: Engine) => async (method: string, path: string, body?: unknown, query?: Record<string, string>) => {
  const r = await e.handle({ method, path, body, query, userId: U });
  if (r.status !== 200) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};
const S = () => on(server), D = () => on(device);
// one round of what the app does: send what changed here, then fetch what changed elsewhere
async function sync() {
  const out = await replica.localChanges(device.db, 500, KEY);
  if (out.changes.length) {
    const res = await S()("POST", "/sync/push", { device: deviceId, changes: out.changes });
    await replica.markSent(device.db, out.upTo);
    if (res.rejected.length) await replica.applyRemote(device.db, U, res.rejected, undefined, KEY);
  }
  for (;;) {
    const m = await replica.replicaMeta(device.db);
    const p = await S()("GET", "/sync/pull", undefined, { since: String(m.cursor), device: deviceId });
    await replica.applyRemote(device.db, U, p.changes, p.cursor, KEY);
    if (!p.more) break;
  }
}

beforeAll(async () => {
  server = await createEngine(await pgliteDb("memory://"), { mode: "server" });
  U = uuidv7();
  await server.db.admin.query("INSERT INTO users (id, username, display_name) VALUES ($1,'u','U')", [U]);
  device = await createEngine(await pgliteDb("memory://"), { mode: "local", seed: false });
}, 120000);

describe("sync", () => {
  it("gives a device a full copy", async () => {
    await S()("PUT", "/settings", { firstDay: 0 });
    const snap = await S()("GET", "/sync/snapshot");
    const m = await replica.loadSnapshot(device.db, snap, KEY);
    deviceId = m.device;
    expect(m.ready).toBe(true);
    expect((await D()("GET", "/me")).settings.firstDay).toBe(0);
    expect(await replica.waitingCount(device.db)).toBe(0);
  });

  it("sends a change made on the device", async () => {
    await D()("PUT", "/settings", { firstDay: 6 });
    expect(await replica.waitingCount(device.db)).toBe(1);
    await sync();
    expect(await replica.waitingCount(device.db)).toBe(0);
    expect((await S()("GET", "/me")).settings.firstDay).toBe(6);
  });

  it("fetches a change made on the server, and the newest wins", async () => {
    await S()("PUT", "/settings", { firstDay: 1 });
    await sync();
    expect((await D()("GET", "/me")).settings.firstDay).toBe(1);
    // the device's older change loses against a newer one on the server
    await device.db.admin.query("SELECT set_config('somnium.sync_at', $1, false)", [new Date(Date.now() - 60_000).toISOString()]);
    await D()("PUT", "/settings", { firstDay: 5 });
    await device.db.admin.query("SELECT set_config('somnium.sync_at', '', false)");
    await S()("PUT", "/settings", { firstDay: 2 });
    await sync();
    expect((await S()("GET", "/me")).settings.firstDay).toBe(2);
    expect((await D()("GET", "/me")).settings.firstDay).toBe(2);
  });

  it("sends a dream written on the device, and its removal", async () => {
    const night = await D()("POST", "/nights", { date: "2026-11-05" });
    const dream = await D()("POST", "/dreams", { nightId: night.id, title: "env:t", lucid: true, lucidityLevel: 3 });
    expect(await replica.waitingCount(device.db)).toBe(2);
    await sync();
    const onServer = await S()("GET", `/dreams/${dream.id}`);
    // the server holds the sealed title; the device reads it plain
    expect(isSealed(onServer.title)).toBe(true);
    expect((await D()("GET", `/dreams/${dream.id}`)).title).toBe("env:t");
    expect(onServer.nightId).toBe(night.id);
    expect((await S()("GET", "/nights"))[0].dreamCount).toBe(1);
    // a removal is a marked row, so it travels like any change
    await D()("DELETE", `/dreams/${dream.id}`);
    await sync();
    expect((await server.handle({ method: "GET", path: `/dreams/${dream.id}`, userId: U })).status).toBe(404);
    // and a dream written on the server reaches the device
    const backId = uuidv7();
    const back = await S()("POST", "/dreams", { id: backId, nightId: night.id, text: await sealColumn("from elsewhere", KEY, "dreams", "text", backId) });
    await sync();
    expect((await D()("GET", `/dreams/${back.id}`)).text).toBe("from elsewhere");
  });
});
