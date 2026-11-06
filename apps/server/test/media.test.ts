// Uploads: the row is written before the file (no stray files from a refused upload), a file can hang on one of
// the person's live dreams and on nobody else's, and a removed file (deleted_at) is gone from GET.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { pgliteDb } from "@somnium/engine/pglite";
import { uuidv7, type Db } from "@somnium/engine";
import { isSealed, newDataKey, sealColumn, unsealColumnBytes } from "@somnium/shared";
import { buildApp } from "../src/app";
import { createSession } from "../src/auth";

let app: FastifyInstance, db: Db, dir: string;
let ann: Record<string, string>, bob: Record<string, string>, annId: string;
const KEY = newDataKey();
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

async function user(name: string) {
  const id = uuidv7();
  await db.admin.query("INSERT INTO users (id, username) VALUES ($1,$2)", [id, name]);
  return { id, headers: { authorization: `Bearer ${await createSession(db, id, "Browser", "web")}` } };
}
// a file as the app sends it: sealed on the device, for an id made on the device
async function upload(headers: Record<string, string>, url = "/api/media", file: Uint8Array = PNG) {
  const id = uuidv7();
  const payload = await sealColumn(new Uint8Array(file), KEY, "media", "data", id);
  return app.inject({ method: "POST", url: `${url}${url.includes("?") ? "&" : "?"}id=${id}`, headers: { ...headers, "content-type": "image/png" }, payload: Buffer.from(payload) });
}
const get = (headers: Record<string, string>, id: string) => app.inject({ method: "GET", url: `/api/media/${id}`, headers });
const filesOf = (id: string) => { const p = path.join(dir, "media", id); return fs.existsSync(p) ? fs.readdirSync(p).length : 0; };

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "somnium-media-test-"));
  db = await pgliteDb("memory://");
  ({ app } = await buildApp({ db, dataDir: dir }));
  ({ id: annId, headers: ann } = await user("ann"));
  ({ headers: bob } = await user("bob"));
}, 120000);
afterAll(async () => { await app.close(); await db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

describe("media", () => {
  it("stores a file as a photo and serves it back to its owner only", async () => {
    const r = await upload(ann);
    expect(r.statusCode).toBe(200);
    const { id } = r.json();
    const row = (await db.admin.query("SELECT kind, dream_id, size FROM media WHERE id = $1", [id])).rows[0];
    expect(row.kind).toBe("photo");
    expect(row.dream_id).toBeNull();
    const got = await get(ann, id);
    expect(got.statusCode).toBe(200);
    // the server hands back what it holds, and only the device can open that
    expect(isSealed(got.rawPayload.toString())).toBe(true);
    expect(Buffer.from(await unsealColumnBytes(got.rawPayload.toString(), KEY, "media", "data", id)).equals(PNG)).toBe(true);
    expect((await get(bob, id)).statusCode).toBe(404);
  });

  it("refuses a file that isn't sealed, or that names no id or a bad one", async () => {
    const before = filesOf(annId);
    const post = (url: string, payload: Buffer) => app.inject({ method: "POST", url, headers: { ...ann, "content-type": "image/png" }, payload });
    const r = await post(`/api/media?id=${uuidv7()}`, PNG);
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toMatch(/sealed by the app/);
    const id = uuidv7(), sealed = Buffer.from(await sealColumn(new Uint8Array(PNG), KEY, "media", "data", id));
    expect((await post("/api/media", sealed)).statusCode).toBe(400);
    expect((await post("/api/media?id=nope", sealed)).statusCode).toBe(400);
    expect(filesOf(annId)).toBe(before);
    // nor can an id be used twice
    expect((await post(`/api/media?id=${id}`, sealed)).statusCode).toBe(200);
    expect((await post(`/api/media?id=${id}`, sealed)).statusCode).toBe(400);
  });

  it("leaves no trace of a photo or its text in the database or the media folder", async () => {
    const MARKER = "PHOTO-MARKER-indigo-heron-7741", OCR = "OCR-TEXT-the-sign-said-tuesday-7742";
    const r = await upload(ann, "/api/media", new TextEncoder().encode(`\x89PNG ${MARKER} rest of the picture`));
    expect(r.statusCode).toBe(200);
    const { id } = r.json();
    // the text read off the photo arrives the way a device sends it, through sync, and only sealed
    const row = (await db.admin.query("SELECT to_jsonb(m) AS r FROM media m WHERE id = $1", [id])).rows[0].r;
    const push = (ocr: string) => app.inject({ method: "POST", url: "/api/sync/push", headers: ann, payload: { device: "d", changes: [{ tbl: "media", pk: { id }, op: "upsert", at: new Date().toISOString(), row: { ...row, ocr_text: ocr } }] } });
    expect((await push(OCR)).statusCode).toBe(400);
    expect((await push(await sealColumn(OCR, KEY, "media", "ocr_text", id))).statusCode).toBe(200);
    expect(isSealed((await db.admin.query("SELECT ocr_text FROM media WHERE id = $1", [id])).rows[0].ocr_text)).toBe(true);

    const names = (await db.admin.query<{ t: string }>("SELECT table_name AS t FROM information_schema.tables WHERE table_schema = 'public'")).rows.map((x) => x.t);
    expect(names).toContain("media");
    let dump = "";
    for (const t of names) dump += JSON.stringify((await db.admin.query(`SELECT to_jsonb(x) AS r FROM ${t} x`)).rows);
    expect(dump).not.toContain(MARKER);
    expect(dump).not.toContain(OCR);

    const files = fs.readdirSync(path.join(dir, "media"), { recursive: true, withFileTypes: true }).filter((f) => f.isFile());
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const bytes = fs.readFileSync(path.join(f.parentPath, f.name));
      expect(bytes.includes(MARKER)).toBe(false);
      expect(bytes.includes(OCR)).toBe(false);
    }
    // on disk it is the envelope, and the device gets its photo back from it
    const stored = fs.readFileSync(path.join(dir, "media", annId, id), "utf8");
    expect(isSealed(stored)).toBe(true);
    expect(new TextDecoder().decode(await unsealColumnBytes(stored, KEY, "media", "data", id))).toContain(MARKER);
  });

  it("never takes a file's place on disk from the row: a pushed path can't reach outside the media folder", async () => {
    const secret = "SECRET-outside-the-media-folder-5521";
    fs.writeFileSync(path.join(dir, "outside.txt"), secret);
    const evil = ["../../etc/passwd", "../outside.txt", "/etc/passwd"];
    const at = () => new Date().toISOString();
    const r = await upload(ann);
    const { id: realId } = r.json();
    const row = (await db.admin.query("SELECT to_jsonb(m) AS r FROM media m WHERE id = $1", [realId])).rows[0].r;
    for (const p of evil) {
      // a new row that names nothing but a path: there is no file, whatever it says
      const fresh = uuidv7();
      const made = await app.inject({ method: "POST", url: "/api/sync/push", headers: ann, payload: { device: "d", changes: [{ tbl: "media", pk: { id: fresh }, op: "upsert", at: at(), row: { ...row, id: fresh, path: p } }] } });
      expect(made.statusCode).toBe(200);
      expect((await db.admin.query("SELECT path FROM media WHERE id = $1", [fresh])).rows[0].path).toBe(p); // the push did store it
      const got = await get(ann, fresh);
      expect(got.statusCode).toBe(404);
      expect(got.body).not.toContain("root:");
      expect(got.body).not.toContain(secret);
      // a real row pointed elsewhere still serves only its own file
      const moved = await app.inject({ method: "POST", url: "/api/sync/push", headers: ann, payload: { device: "d", changes: [{ tbl: "media", pk: { id: realId }, op: "upsert", at: at(), row: { ...row, path: p } }] } });
      expect(moved.statusCode).toBe(200);
      const own = await get(ann, realId);
      expect(own.statusCode).toBe(200);
      expect(isSealed(own.rawPayload.toString())).toBe(true);
      expect(own.body).not.toContain(secret);
    }
  });

  it("hangs a file on one of the person's live dreams, and on nothing else", async () => {
    const night = (await app.inject({ method: "POST", url: "/api/nights", headers: ann, payload: { date: "2026-11-05" } })).json();
    const dream = (await app.inject({ method: "POST", url: "/api/dreams", headers: ann, payload: { nightId: night.id } })).json();
    const r = await upload(ann, `/api/media?dreamId=${dream.id}`);
    expect(r.statusCode).toBe(200);
    expect((await db.admin.query("SELECT dream_id FROM media WHERE id = $1", [r.json().id])).rows[0].dream_id).toBe(dream.id);

    const before = filesOf(annId);
    expect((await upload(ann, `/api/media?dreamId=${uuidv7()}`)).statusCode).toBe(400);
    expect((await upload(ann, "/api/media?dreamId=nope")).statusCode).toBe(400);
    // someone else's dream is unknown to this person
    expect((await upload(bob, `/api/media?dreamId=${dream.id}`)).statusCode).toBe(400);
    // a refused upload leaves no file behind
    expect(filesOf(annId)).toBe(before);

    // removing the dream takes its media out of sight
    expect((await app.inject({ method: "DELETE", url: `/api/dreams/${dream.id}`, headers: ann })).statusCode).toBe(200);
    expect((await get(ann, r.json().id)).statusCode).toBe(404);
    expect((await upload(ann, `/api/media?dreamId=${dream.id}`)).statusCode).toBe(400);
  });

  it("hides a removed file", async () => {
    const { id } = (await upload(ann)).json();
    expect((await get(ann, id)).statusCode).toBe(200);
    await db.admin.query("UPDATE media SET deleted_at = now() WHERE id = $1", [id]);
    expect((await get(ann, id)).statusCode).toBe(404);
  });
});

// The desktop app's own server for a local account: plaintext on the device is where it belongs.
describe("media on a local account", () => {
  it("takes a file as it is", async () => {
    const localDir = fs.mkdtempSync(path.join(os.tmpdir(), "somnium-media-local-"));
    const localDb = await pgliteDb("memory://");
    const local = await buildApp({ db: localDb, dataDir: localDir, mode: "local" });
    const id = uuidv7();
    await localDb.admin.query("INSERT INTO users (id, username) VALUES ($1,'me')", [id]);
    const headers = { authorization: `Bearer ${await createSession(localDb, id, "Browser", "web")}` };
    const r = await local.app.inject({ method: "POST", url: "/api/media", headers: { ...headers, "content-type": "image/png" }, payload: PNG });
    expect(r.statusCode).toBe(200);
    expect((await local.app.inject({ method: "GET", url: `/api/media/${r.json().id}`, headers })).rawPayload.equals(PNG)).toBe(true);
    await local.app.close(); await localDb.close(); fs.rmSync(localDir, { recursive: true, force: true });
  }, 120000);
});
