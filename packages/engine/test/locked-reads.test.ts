// What code running while the journal is locked can reach (LDJ-28 review). A server account's device copy holds the
// journal opened, and both transports (apps/web/src/api/replica.ts for the copy, client.ts sealingTransport for the
// server) ask allowedWithoutKey before anything while the key is closed. This puts a journal in the clear in a device
// engine, as the copy holds it, and asks every route the engine has: whatever is let through must answer nothing of it.
import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createEngine, type Engine } from "../src/index";
import { pgliteDb } from "../src/adapters/pglite";
import { uuidv7 } from "../src/ids";
import { allowedWithoutKey } from "../src/sync/sealedApi";

const SECRET = "LOCKED-SECRET-7f3a";
let eng: Engine, A: string;
const ids: Record<string, string> = {};
const handle = (method: string, p: string, body?: unknown) => eng.handle({ method, path: p, body, userId: A });

// every route the engine registers, read from its modules so a new one is asked as well
const ROUTES = fs.readdirSync(path.join(__dirname, "../src/modules")).filter((f) => f.endsWith(".ts")).flatMap((f) =>
  [...fs.readFileSync(path.join(__dirname, "../src/modules", f), "utf8").matchAll(/\br\.(get|post|put|del)\("([^"]+)"/g)]
    .map((m) => ({ method: m[1] === "del" ? "DELETE" : m[1]!.toUpperCase(), route: m[2]! })));
// the copy never answers these itself: they go to the server (SERVER_ONLY in replica.ts), which holds only ciphertext
const toServer = (route: string) => /^\/sync(\/|$)/.test(route);
const fill = (route: string) => route.replace(/\/([^/:]+)\/:[a-zA-Z]+/g, (_, seg: string) => `/${seg}/${ids[seg] ?? uuidv7()}`).replace(/:[a-zA-Z]+/g, () => uuidv7());

beforeAll(async () => {
  eng = await createEngine(await pgliteDb("memory://"), { mode: "local" });
  A = uuidv7();
  await eng.db.admin.query("INSERT INTO users (id, username, display_name) VALUES ($1,'a','A')", [A]);
  const ok = async (m: string, p: string, b: unknown) => { const r = await handle(m, p, b); expect(r.status, `${m} ${p}`).toBe(200); return r.body as any; };
  const night = await ok("POST", "/nights", { date: "2026-11-05", notes: SECRET, intention: SECRET, substances: SECRET });
  const dream = await ok("POST", "/dreams", { nightId: night.id, title: SECRET, text: SECRET, lucid: true, lucidTrigger: SECRET });
  const el = await ok("POST", "/elements", { kind: "character", name: SECRET, aliases: SECRET, note: SECRET, isDreamSign: true });
  await ok("POST", `/dreams/${dream.id}/elements`, { elementId: el.id, span: SECRET });
  const check = await ok("POST", "/reality-checks", { kind: "hands", note: SECRET });
  const practice = await ok("POST", "/practice", { date: "2026-11-05", item: "wbtb", note: SECRET });
  await ok("PUT", "/course/lesson-1", { state: "done", answers: SECRET });
  Object.assign(ids, { nights: night.id, dreams: dream.id, elements: el.id, "reality-checks": check.id, practice: practice.id, course: "lesson-1" });
}, 120000);

describe("while the journal is locked", () => {
  it("finds the engine's routes", () => {
    expect(ROUTES.length).toBeGreaterThan(30);
    expect(ROUTES).toContainEqual({ method: "GET", route: "/elements" });
  });

  it("every route let through answers nothing of the journal", async () => {
    const reached: string[] = [];
    for (const { method, route } of ROUTES) {
      if (toServer(route)) continue;
      const p = fill(route);
      if (!allowedWithoutKey(method, p, {})) continue;
      reached.push(`${method} ${route}`);
      const r = await handle(method, p, method === "GET" ? undefined : {});
      expect(JSON.stringify(r.body) ?? "", `${method} ${route}`).not.toContain(SECRET);
    }
    // what a runner can reach is settings, goals, reminders, the activity log and an import's preview: nothing sealed
    expect(reached.some((x) => /\/(dreams|nights|elements|dream-elements|reality-checks|practice|course|export)\b/.test(x.split(" ")[1]!) && x.startsWith("GET"))).toBe(false);
  });

  it("refuses every read of a journal table, however the path is written", () => {
    for (const p of ["/dreams", `/dreams/${ids.dreams}`, "/nights", "/elements", "/elements?signs=1", "/dream-elements", "/reality-checks",
      "/practice", "/course", "/export", "/dreams/", "//dreams", "/./dreams", "/x/../dreams", "/elements/", `/dreams/${ids.dreams}/elements`]) {
      expect(allowedWithoutKey("GET", p), p).toBe(false);
    }
    expect(allowedWithoutKey("get", "/dreams")).toBe(false);
  });

  it("refuses every journal write but a new check with nothing sealed in it", () => {
    expect(allowedWithoutKey("PUT", `/dreams/${ids.dreams}`, {})).toBe(false); // an edit answers the whole row
    expect(allowedWithoutKey("DELETE", `/nights/${ids.nights}`)).toBe(false);
    expect(allowedWithoutKey("POST", "/import", { data: {} })).toBe(false);
    expect(allowedWithoutKey("POST", "/reality-checks", { kind: "hands", note: "x" })).toBe(false);
    expect(allowedWithoutKey("POST", "/reality-checks/", { kind: "hands" })).toBe(false);
    expect(allowedWithoutKey("PUT", `/reality-checks/${ids["reality-checks"]}`, { outcome: "awake" })).toBe(false);
    expect(allowedWithoutKey("POST", "/reality-checks", { id: uuidv7(), at: new Date().toISOString(), kind: "hands", outcome: "awake", prompted: true })).toBe(true);
    // what /check and the lock screen need besides: nothing of the journal
    expect(allowedWithoutKey("GET", "/me")).toBe(true);
    expect(allowedWithoutKey("GET", "/reminders")).toBe(true);
  });
});
