// A device's copy belongs to one person (PLAN.md §4.1). A request to /sync/* says whose copy it comes from, and the
// server refuses it under anyone else's session, so a copy still at work when someone else signs in can't reach their account.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { pgliteDb } from "@somnium/engine/pglite";
import { uuidv7, type Db } from "@somnium/engine";
import { COPY_OWNER_HEADER, COPY_OWNER_REFUSED } from "@somnium/shared";
import { buildApp } from "../src/app";
import { createSession } from "../src/auth";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let app: FastifyInstance, db: Db, dir: string;
let ann: { id: string; headers: Record<string, string> }, bob: { id: string; headers: Record<string, string> };

async function user(name: string) {
  const id = uuidv7();
  await db.admin.query("INSERT INTO users (id, username) VALUES ($1,$2)", [id, name]);
  return { id, headers: { authorization: `Bearer ${await createSession(db, id, "Browser", "web")}` } };
}
const rowsOf = async (key: string, userId: string) =>
  (await db.admin.query("SELECT count(*)::int AS n FROM reality_checks WHERE id = $1 AND user_id = $2", [key, userId])).rows[0].n as number;
const change = (id: string, userId: string) => ({ tbl: "reality_checks", pk: { id }, op: "upsert", at: new Date().toISOString(), row: { id, user_id: userId, at: new Date().toISOString() } });

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "somnium-copy-owner-test-"));
  db = await pgliteDb("memory://");
  ({ app } = await buildApp({ db, dataDir: dir }));
  ann = await user("ann");
  bob = await user("bob");
}, 120000);
afterAll(async () => { await app.close(); await db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

describe("a copy's requests under someone else's session", () => {
  it("refuses a push from Ann's copy under Bob's session, and stores nothing", async () => {
    const id = uuidv7();
    const r = await app.inject({ method: "POST", url: "/api/sync/push", headers: { ...bob.headers, [COPY_OWNER_HEADER]: ann.id }, payload: { device: "d", changes: [change(id, bob.id)] } });
    expect(r.statusCode).toBe(COPY_OWNER_REFUSED);
    expect(await rowsOf(id, bob.id)).toBe(0);
    expect(await rowsOf(id, ann.id)).toBe(0);
    // the same push from Bob's own copy does store it, so the zero above means something
    const own = await app.inject({ method: "POST", url: "/api/sync/push", headers: { ...bob.headers, [COPY_OWNER_HEADER]: bob.id }, payload: { device: "d", changes: [change(id, bob.id)] } });
    expect(own.statusCode).toBe(200);
    expect(own.json().failed ?? []).toEqual([]);
    expect(await rowsOf(id, bob.id)).toBe(1);
  });
  it.each(["/api/sync/pull?since=0&device=d", "/api/sync/snapshot"])("refuses %s too, and sends nothing of Bob's", async (url) => {
    const r = await app.inject({ method: "GET", url, headers: { ...bob.headers, [COPY_OWNER_HEADER]: ann.id } });
    expect(r.statusCode).toBe(COPY_OWNER_REFUSED);
    expect(r.json().tables).toBeUndefined();
    expect(r.json().changes).toBeUndefined();
  });
  it.each(["/api/sync/snapshot/", "/api//sync/snapshot", "/api/sync//snapshot"])("isn't fooled by the path %s", async (url) => {
    const r = await app.inject({ method: "GET", url, headers: { ...bob.headers, [COPY_OWNER_HEADER]: ann.id } });
    expect(r.statusCode).toBe(COPY_OWNER_REFUSED);
  });
  it("refuses a request that doesn't say whose copy it is", async () => {
    const r = await app.inject({ method: "GET", url: "/api/sync/pull?since=0&device=d", headers: bob.headers });
    expect(r.statusCode).toBe(COPY_OWNER_REFUSED);
  });
  it("takes a copy's requests under its own person's session", async () => {
    const headers = { ...ann.headers, [COPY_OWNER_HEADER]: ann.id };
    const pull = await app.inject({ method: "GET", url: "/api/sync/pull?since=0&device=d", headers });
    expect(pull.statusCode).toBe(200);
    const snap = await app.inject({ method: "GET", url: "/api/sync/snapshot", headers });
    expect(snap.statusCode).toBe(200);
    const push = await app.inject({ method: "POST", url: "/api/sync/push", headers, payload: { device: "d", changes: [] } });
    expect(push.statusCode).toBe(200);
  });
  it("still asks for a session first", async () => {
    const r = await app.inject({ method: "GET", url: "/api/sync/snapshot", headers: { [COPY_OWNER_HEADER]: ann.id } });
    expect(r.statusCode).toBe(401);
  });
  it("leaves the other routes alone", async () => {
    const r = await app.inject({ method: "GET", url: "/api/nights", headers: bob.headers });
    expect(r.statusCode).toBe(200);
  });
});
