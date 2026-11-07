// A dream's files (LDJ-20): the list, the text read from a photo, removing one, and that nobody else's are visible.
// The files themselves go through the server's /api/media (apps/server); these are the rows.
import { describe, it, expect, beforeAll } from "vitest";
import { createEngine, type Engine } from "../src/index";
import { pgliteDb } from "../src/adapters/pglite";
import { uuidv7 } from "../src/ids";
import { isJournalRoute, isMediaUpload, plaintextSealedFields } from "../src/sync/sealedApi";

let eng: Engine;
let A: string, B: string, dreamId: string, photo: string;
const call = async (user: string, method: string, path: string, body?: unknown, query?: Record<string, string>) => eng.handle({ method, path, body, query, userId: user });

beforeAll(async () => {
  eng = await createEngine(await pgliteDb("memory://"), { mode: "local" });
  A = uuidv7(); B = uuidv7();
  await eng.db.admin.query("INSERT INTO users (id, username, display_name) VALUES ($1,'a','A'), ($2,'b','B')", [A, B]);
  const night = (await call(A, "POST", "/nights", { date: "2026-11-01" })).body as { id: string };
  dreamId = ((await call(A, "POST", "/dreams", { nightId: night.id, text: "x" })).body as { id: string }).id;
  photo = uuidv7();
  await eng.db.admin.query("INSERT INTO media (id, user_id, kind, mime, size, path, dream_id, data) VALUES ($1,$2,'photo','image/jpeg',10,'p',$3,'secret-bytes'), ($4,$2,'audio','audio/webm',20,'q',$3,NULL)", [photo, A, dreamId, uuidv7()]);
}, 120000);

describe("media rows", () => {
  it("lists a dream's files without the file itself or where the server keeps it", async () => {
    const r = await call(A, "GET", "/media", undefined, { dreamId });
    expect(r.status).toBe(200);
    const rows = r.body as Record<string, unknown>[];
    expect(rows.map((m) => m.kind)).toEqual(["photo", "audio"]);
    for (const m of rows) { expect(m).not.toHaveProperty("data"); expect(m).not.toHaveProperty("path"); }
  });
  it("keeps the text read from a photo, and removes a file", async () => {
    const put = await call(A, "PUT", `/media/${photo}`, { ocrText: "I was flying" });
    expect(put.status).toBe(200);
    expect(put.body).not.toHaveProperty("data");
    expect((put.body as { ocrText: string }).ocrText).toBe("I was flying");
    expect((await call(A, "DELETE", `/media/${photo}`)).status).toBe(200);
    expect(((await call(A, "GET", "/media", undefined, { dreamId })).body as unknown[]).length).toBe(1);
  });
  it("shows nobody else's files and lets nobody else change them", async () => {
    expect((await call(B, "GET", "/media", undefined, { dreamId })).body).toEqual([]);
    const other = (await call(A, "GET", "/media", undefined, { dreamId })).body as { id: string }[];
    expect((await call(B, "PUT", `/media/${other[0]!.id}`, { ocrText: "x" })).status).toBe(404);
  });
  it("the read text is sealed on the way out like the dream's own; the file goes up apart", () => {
    expect(isJournalRoute("/media?dreamId=x")).toBe(true);
    expect(plaintextSealedFields("PUT", "/media/abc", { ocrText: "plain" })).toEqual(["ocrText"]);
    expect(isMediaUpload("/media")).toBe(true);
    expect(isMediaUpload("/media/abc")).toBe(false);
  });
});
