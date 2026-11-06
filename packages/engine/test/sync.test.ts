// Offline use: a device works on its own copy of a server account and syncs both ways; the newest change wins.
import { describe, it, expect, beforeAll } from "vitest";
import { createEngine, replica, type Engine } from "../src/index";
import { pgliteDb } from "../src/adapters/pglite";
import { uuidv7 } from "../src/ids";

let server: Engine, device: Engine, U: string, deviceId = "";
const on = (e: Engine) => async (method: string, path: string, body?: unknown, query?: Record<string, string>) => {
  const r = await e.handle({ method, path, body, query, userId: U });
  if (r.status !== 200) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};
const S = () => on(server), D = () => on(device);
// one round of what the app does: send what changed here, then fetch what changed elsewhere
async function sync() {
  const out = await replica.localChanges(device.db);
  if (out.changes.length) {
    const res = await S()("POST", "/sync/push", { device: deviceId, changes: out.changes });
    await replica.markSent(device.db, out.upTo);
    if (res.rejected.length) await replica.applyRemote(device.db, U, res.rejected);
  }
  for (;;) {
    const m = await replica.replicaMeta(device.db);
    const p = await S()("GET", "/sync/pull", undefined, { since: String(m.cursor), device: deviceId });
    await replica.applyRemote(device.db, U, p.changes, p.cursor);
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
    const m = await replica.loadSnapshot(device.db, snap);
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
});
