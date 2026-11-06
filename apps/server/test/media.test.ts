// Uploads: the row is written before the file (no stray files from a refused upload), a file can hang on one of
// the person's live dreams and on nobody else's, and a removed file (deleted_at) is gone from GET.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { pgliteDb } from "@somnium/engine/pglite";
import { uuidv7, type Db } from "@somnium/engine";
import { buildApp } from "../src/app";
import { createSession } from "../src/auth";

let app: FastifyInstance, db: Db, dir: string;
let ann: Record<string, string>, bob: Record<string, string>, annId: string;
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

async function user(name: string) {
  const id = uuidv7();
  await db.admin.query("INSERT INTO users (id, username) VALUES ($1,$2)", [id, name]);
  return { id, headers: { authorization: `Bearer ${await createSession(db, id, "Browser", "web")}` } };
}
const upload = (headers: Record<string, string>, url = "/api/media") =>
  app.inject({ method: "POST", url, headers: { ...headers, "content-type": "image/png" }, payload: PNG });
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
    expect(row).toMatchObject({ kind: "photo", dream_id: null, size: PNG.length });
    const got = await get(ann, id);
    expect(got.statusCode).toBe(200);
    expect(got.rawPayload.equals(PNG)).toBe(true);
    expect((await get(bob, id)).statusCode).toBe(404);
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
