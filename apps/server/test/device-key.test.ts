// Device keys (LDJ-10, PLAN.md §4.4): a device that holds the data key sets a new password without the old one. The
// proof (keyProof, one-way from the data key) is registered only while the password is proven, a session must have
// registered a device key, a wrong proof is counted like a wrong password, two-factor still applies, and the
// signed-in devices list says which hold a key. The crypto runs through the real helpers.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { pgliteDb } from "@somnium/engine/pglite";
import type { Db } from "@somnium/engine";
import { createAccountKeys, changePassword, keyProof, openWithPassword } from "@somnium/shared";
import { buildApp } from "../src/app";
import { totp, forgetFails } from "../src/auth";

let app: FastifyInstance, db: Db, dir: string, admin = false;
const post = (url: string, payload: unknown, headers: Record<string, string> = {}) => app.inject({ method: "POST", url: "/api" + url, payload, headers });
const get = (url: string, headers: Record<string, string> = {}) => app.inject({ method: "GET", url: "/api" + url, headers });
const del = (url: string, headers: Record<string, string> = {}) => app.inject({ method: "DELETE", url: "/api" + url, headers });
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const PW = "correct horse battery";
const random = () => crypto.randomBytes(32).toString("base64url");

async function invite() { const code = "inv" + Math.random().toString(36).slice(2); await db.admin.query("INSERT INTO invites (code, expires_at) VALUES ($1, now() + interval '1 day')", [code]); return code; }
/** Signs up without a proof (an account from before device keys), then signs in a second device. */
async function account(username: string) {
  const keys = await createAccountKeys(PW);
  const extra = admin ? { invite: await invite() } : {};
  admin = true;
  const r = await post("/auth/sign-up", { username, authKey: keys.authKey, kdfSalt: keys.salt, wrappedByPassword: keys.wrappedByPassword, wantToken: true, ...extra });
  expect(r.statusCode).toBe(200);
  const other = await post("/auth/sign-in", { username, authKey: keys.authKey, wantToken: true, deviceName: "Other" });
  return { keys, h: bearer(r.json().token), other: bearer(other.json().token), proof: await keyProof(keys.dataKey) };
}
async function newPasswordBody(dataKey: Uint8Array, extra: Record<string, unknown> = {}) {
  const pw = await changePassword(dataKey, "a whole new password");
  return { pw, body: { keyProof: await keyProof(dataKey), authKey: pw.authKey, kdfSalt: pw.salt, wrappedByPassword: pw.wrappedByPassword, ...extra } };
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "somnium-devicekey-test-"));
  db = await pgliteDb("memory://");
  ({ app } = await buildApp({ db, dataDir: dir }));
}, 120000);
afterAll(async () => { await app.close(); await db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
beforeEach(() => forgetFails(db));

describe("device keys", () => {
  it("registers the proof only with the password, and a session holds a key only with the proof", async () => {
    const { keys, h, proof } = await account("holder");
    // no proof yet: a session alone can't make one up
    expect((await post("/auth/device-key", { keyProof: proof }, h)).statusCode).toBe(409);
    expect((await post("/auth/key-proof", { keyProof: random(), authKey: random() }, h)).statusCode).toBe(403);
    expect((await post("/auth/key-proof", { keyProof: proof, authKey: keys.authKey }, h)).statusCode).toBe(200);
    // the first one stays: a different one is refused, the same one is fine
    expect((await post("/auth/key-proof", { keyProof: random(), authKey: keys.authKey }, h)).statusCode).toBe(409);
    expect((await post("/auth/key-proof", { keyProof: proof, authKey: keys.authKey }, h)).statusCode).toBe(200);
    expect((await post("/auth/device-key", { keyProof: random() }, h)).statusCode).toBe(403);
    expect((await post("/auth/device-key", { keyProof: proof }, h)).statusCode).toBe(200);
    const list = (await get("/auth/sessions", h)).json() as { current: boolean; holdsKey: boolean }[];
    expect(list.find((x) => x.current)?.holdsKey).toBe(true);
    expect(list.filter((x) => !x.current).every((x) => !x.holdsKey)).toBe(true);
    expect((await del("/auth/device-key", h)).statusCode).toBe(200);
    expect(((await get("/auth/sessions", h)).json() as { current: boolean; holdsKey: boolean }[]).find((x) => x.current)?.holdsKey).toBe(false);
  }, 90000);

  it("sets a new password from a device that holds the key, without the old one", async () => {
    const { keys, h, other, proof } = await account("forgot");
    await post("/auth/key-proof", { keyProof: proof, authKey: keys.authKey }, h);
    const { pw, body } = await newPasswordBody(keys.dataKey);
    // a session that never registered a device key can't, even with the proof
    expect((await post("/auth/password/device", body, other)).statusCode).toBe(403);
    expect((await post("/auth/device-key", { keyProof: proof }, h)).statusCode).toBe(200);
    expect((await post("/auth/password/device", body)).statusCode).toBe(401);
    expect((await post("/auth/password/device", { ...body, keyProof: random() }, h)).statusCode).toBe(403);
    const r = await post("/auth/password/device", body, h);
    expect(r.statusCode).toBe(200);
    // the old password is gone, the new one signs in and opens the same data key; the other device was signed out
    expect((await post("/auth/sign-in", { username: "forgot", authKey: keys.authKey })).statusCode).toBe(401);
    const signed = await post("/auth/sign-in", { username: "forgot", authKey: pw.authKey });
    expect(signed.statusCode).toBe(200);
    expect(await openWithPassword({ salt: signed.json().kdfSalt, wrappedByPassword: signed.json().wrappedByPassword }, "a whole new password")).toEqual(keys.dataKey);
    expect((await get("/auth/sessions", other)).statusCode).toBe(401);
    expect((await get("/auth/sessions", h)).statusCode).toBe(200);
  }, 90000);

  it("counts a wrong proof like a wrong password", async () => {
    const { keys, h, proof } = await account("guesser");
    await post("/auth/key-proof", { keyProof: proof, authKey: keys.authKey }, h);
    await post("/auth/device-key", { keyProof: proof }, h);
    const { body } = await newPasswordBody(keys.dataKey);
    let last = 0;
    for (let i = 0; i < 12 && last !== 429; i++) last = (await post("/auth/password/device", { ...body, keyProof: random() }, h)).statusCode;
    expect(last).toBe(429);
    // the right proof waits too (per session), and so does signing in from that address (per address)
    expect((await post("/auth/password/device", body, h)).statusCode).toBe(429);
    expect((await post("/auth/sign-in", { username: "guesser", authKey: keys.authKey })).statusCode).toBe(429);
  }, 90000);

  it("still asks for the authenticator or a backup code when two-factor is on", async () => {
    const { keys, h, proof } = await account("twofa");
    await post("/auth/key-proof", { keyProof: proof, authKey: keys.authKey }, h);
    await post("/auth/device-key", { keyProof: proof }, h);
    const { secret } = (await post("/auth/2fa/start", { authKey: keys.authKey }, h)).json();
    const codes: string[] = (await post("/auth/2fa/enable", { code: totp(secret) }, h)).json().backupCodes;
    const { body } = await newPasswordBody(keys.dataKey);
    const none = await post("/auth/password/device", body, h);
    expect(none.statusCode).toBe(403);
    expect(none.json().totpRequired).toBe(true);
    expect((await post("/auth/password/device", { ...body, code: "000000" }, h)).json().totpRequired).toBe(true);
    expect((await post("/auth/password/device", { ...body, code: codes[0] }, h)).statusCode).toBe(200);
  }, 90000);

  it("registers the proof at sign-up when the device sends it", async () => {
    const keys = await createAccountKeys(PW);
    const r = await post("/auth/sign-up", { username: "fresh", authKey: keys.authKey, kdfSalt: keys.salt, wrappedByPassword: keys.wrappedByPassword, wantToken: true, invite: await invite(), keyProof: await keyProof(keys.dataKey) });
    const h = bearer(r.json().token);
    expect((await post("/auth/device-key", { keyProof: await keyProof(keys.dataKey) }, h)).statusCode).toBe(200);
  }, 90000);
});
