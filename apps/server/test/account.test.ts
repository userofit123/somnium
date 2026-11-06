// Deleting your own account asks for the password again: a wrong one is refused without signing you out,
// too many wrong ones wait like sign-in does, and the right one deletes everything.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { pgliteDb } from "@somnium/engine/pglite";
import { uuidv7, type Db } from "@somnium/engine";
import { buildApp } from "../src/app";
import { hashSecret, createSession } from "../src/auth";

let app: FastifyInstance, db: Db, dir: string;
// the device sends authKey (derived from the password there) in place of the password; any 43-character base64url value will do here
const PW = "Q".repeat(43);

async function user(name: string, role = "user") {
  await db.admin.query("INSERT INTO users (id, username, auth_hash, role) VALUES ($1,$2,$3,$4)", [uuidv7(), name, await hashSecret(PW), role]);
  const r = await app.inject({ method: "POST", url: "/api/auth/sign-in", payload: { username: name, authKey: PW, wantToken: true } });
  return { authorization: `Bearer ${r.json().token}` };
}
const del = (headers: Record<string, string>, authKey?: string) =>
  app.inject({ method: "DELETE", url: "/api/auth/account", headers, payload: authKey === undefined ? {} : { authKey } });
const signedIn = async (headers: Record<string, string>) => (await app.inject({ method: "GET", url: "/api/auth/sessions", headers })).statusCode === 200;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "somnium-server-test-"));
  db = await pgliteDb("memory://");
  ({ app } = await buildApp({ db, dataDir: dir }));
  await user("boss", "admin");
}, 120000);
afterAll(async () => { await app.close(); await db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

describe("deleting your own account", () => {
  it("needs the right password and keeps you signed in when it is wrong", async () => {
    const h = await user("ann");
    expect((await del(h)).statusCode).toBe(403);
    const wrong = await del(h, "W".repeat(43));
    expect(wrong.statusCode).toBe(403);
    expect(wrong.json().error).toBe("Wrong password");
    expect(await signedIn(h)).toBe(true);
    expect((await db.admin.query("SELECT 1 FROM users WHERE username = 'ann'")).rows.length).toBe(1);

    expect((await del(h, PW)).statusCode).toBe(200);
    expect((await db.admin.query("SELECT 1 FROM users WHERE username = 'ann'")).rows.length).toBe(0);
    expect(await signedIn(h)).toBe(false);
  });

  it("waits after too many wrong passwords, like signing in", async () => {
    const h = await user("bob");
    // the wrong tries above count too (same address), so the wait may start before the fifth here
    for (let i = 0; i < 5; i++) expect([403, 429]).toContain((await del(h, String(i).repeat(43))).statusCode);
    expect((await del(h, PW)).statusCode).toBe(429);
    expect((await db.admin.query("SELECT 1 FROM users WHERE username = 'bob'")).rows.length).toBe(1);
  });
});

describe("signing out the other devices", () => {
  it("leaves API tokens alone", async () => {
    // a session made directly: the earlier wrong passwords here have put this address on the sign-in wait
    const id = uuidv7();
    await db.admin.query("INSERT INTO users (id, username, auth_hash) VALUES ($1,$2,$3)", [id, "cy", await hashSecret(PW)]);
    const h = { authorization: `Bearer ${await createSession(db, id, "Browser", "web")}` };
    const api = { authorization: `Bearer ${await createSession(db, id, "script", "api")}` };
    expect((await app.inject({ method: "POST", url: "/api/auth/logout-others", headers: h })).statusCode).toBe(200);
    expect(await signedIn(api)).toBe(true);
    expect(await signedIn(h)).toBe(true);
  });
});
