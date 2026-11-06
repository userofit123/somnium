// The edges of sync and the direct API: rows that arrive before their parent, two devices making the same lesson or
// link offline, files that lie about being sealed, paths the router accepts, and exports with a row that won't open.
import { describe, it, expect, beforeAll } from "vitest";
import { newDataKey, isSealed, sealColumn, unsealColumn, SealError } from "@somnium/shared";
import { createEngine, replica, isJournalRoute, sealRequest, openResponse, type Engine, type Change } from "../src/index";
import { pgliteDb } from "../src/adapters/pglite";
import { uuidv7 } from "../src/ids";

const KEY = newDataKey(), OTHER_KEY = newDataKey();
const NEVER = async () => { throw new Error("no lookup expected"); };
type Rec = Record<string, any>;

let server: Engine, U: string;
const on = (e: Engine) => async (method: string, path: string, body?: unknown, query?: Record<string, string>) => {
  const r = await e.handle({ method, path, body, query, userId: U });
  if (r.status !== 200) throw Object.assign(new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`), { status: r.status });
  return r.body as any;
};
const S = () => on(server);
const later = () => new Promise((ok) => setTimeout(ok, 5));

interface Device { eng: Engine; id: string }
async function newDevice(): Promise<Device> {
  const eng = await createEngine(await pgliteDb("memory://"), { mode: "local", seed: false });
  const m = await replica.loadSnapshot(eng.db, await S()("GET", "/sync/snapshot"), KEY);
  return { eng, id: m.device };
}
// one round of what the app does: send what changed here, then fetch what changed elsewhere
async function sync(d: Device) {
  for (;;) {
    const out = await replica.localChanges(d.eng.db, 500, KEY);
    if (!out.changes.length) break;
    const res = await S()("POST", "/sync/push", { device: d.id, changes: out.changes });
    expect(res.failed).toEqual([]);
    await replica.markSent(d.eng.db, out.upTo);
    if (res.rejected.length) await replica.applyRemote(d.eng.db, U, res.rejected, undefined, KEY);
  }
  await pull(d);
}
async function pull(d: Device) {
  for (;;) {
    const m = await replica.replicaMeta(d.eng.db);
    const p = await S()("GET", "/sync/pull", undefined, { since: String(m.cursor), device: d.id });
    const r = await replica.applyRemote(d.eng.db, U, p.changes, p.cursor, KEY);
    expect(r.heldBack).toBe(0);
    if (!p.more) break;
  }
}

beforeAll(async () => {
  server = await createEngine(await pgliteDb("memory://"), { mode: "server" });
  U = uuidv7();
  await server.db.admin.query("INSERT INTO users (id, username, display_name) VALUES ($1,'u','U')", [U]);
}, 120000);

describe("a row that arrives before its parent", () => {
  it("is held back, counted, and comes in once the parent arrives, opened only once", async () => {
    const d = await newDevice();
    const nightId = uuidv7(), dreamId = uuidv7(), at = new Date().toISOString();
    // a person's text that merely looks like an envelope: opening it a second time would set the row aside for good
    const looksSealed = await sealColumn("inner", OTHER_KEY, "dreams", "text", dreamId);
    const sealed = await sealColumn(looksSealed, KEY, "dreams", "text", dreamId);
    const dream: Change = { tbl: "dreams", pk: { id: dreamId }, op: "upsert", at, row: { id: dreamId, night_id: nightId, text: sealed } };
    const night: Change = { tbl: "nights", pk: { id: nightId }, op: "upsert", at, row: { id: nightId, date: "2026-03-03" } };

    const first = await replica.applyRemote(d.eng.db, U, [dream], 11, KEY);
    expect([first.unopened, first.heldBack]).toEqual([0, 1]);
    const meta = await replica.replicaMeta(d.eng.db);
    expect(meta.cursor).toBe(11);
    // kept as it came: no plaintext goes into the list, and the next try opens it once
    expect(meta.heldBack![0]!.row!.text).toBe(sealed);
    expect((await d.eng.handle({ method: "GET", path: `/dreams/${dreamId}`, userId: U })).status).toBe(404);

    // nothing new yet: still held, still counted once
    expect((await replica.applyRemote(d.eng.db, U, [], 11, KEY)).heldBack).toBe(1);
    // a newer version of the held row replaces it
    const newerText = await sealColumn(looksSealed, KEY, "dreams", "text", dreamId);
    const newer = { ...dream, row: { ...dream.row, text: newerText, title: await sealColumn("newer", KEY, "dreams", "title", dreamId) } };
    expect((await replica.applyRemote(d.eng.db, U, [newer], 12, KEY)).heldBack).toBe(1);

    const last = await replica.applyRemote(d.eng.db, U, [night], 13, KEY);
    expect([last.unopened, last.heldBack, last.failed]).toEqual([0, 0, []]);
    const back = await on(d.eng)("GET", `/dreams/${dreamId}`);
    expect(back.text).toBe(looksSealed);
    expect(back.title).toBe("newer");
    expect((await replica.replicaMeta(d.eng.db)).unopened).toEqual([]);
  });

  it("keeps waiting while locked, and a plain page still goes through", async () => {
    const d = await newDevice();
    const nightId = uuidv7(), dreamId = uuidv7(), at = new Date().toISOString();
    const dream: Change = { tbl: "dreams", pk: { id: dreamId }, op: "upsert", at, row: { id: dreamId, night_id: nightId, text: await sealColumn("later", KEY, "dreams", "text", dreamId) } };
    await replica.applyRemote(d.eng.db, U, [dream], undefined, KEY);
    expect((await replica.applyRemote(d.eng.db, U, [], undefined, null)).heldBack).toBe(1);
    const night: Change = { tbl: "nights", pk: { id: nightId }, op: "upsert", at, row: { id: nightId, date: "2026-03-04" } };
    expect((await replica.applyRemote(d.eng.db, U, [night], undefined, KEY)).heldBack).toBe(0);
    expect((await on(d.eng)("GET", `/dreams/${dreamId}`)).text).toBe("later");
  });
});

describe("two devices that make the same lesson or link offline", () => {
  /** One live row everywhere, under one id, opening for that id on the server; answers what it holds. */
  async function converged(a: Device, b: Device, list: (e: Engine) => Promise<Rec[]>, col: string, table: string): Promise<Rec> {
    const [onA, onB, onS] = await Promise.all([list(a.eng), list(b.eng), list(server)]);
    for (const l of [onA, onB, onS]) expect(l).toHaveLength(1);
    expect(onA[0]!.id).toBe(onS[0]!.id);
    expect(onB[0]!.id).toBe(onS[0]!.id);
    expect(onA[0]![col]).toBe(onB[0]![col]);
    const column = col === "answers" ? "answers" : "span";
    expect(isSealed(onS[0]![col])).toBe(true);
    expect(await unsealColumn(onS[0]![col], KEY, table, column, onS[0]!.id)).toBe(onA[0]![col]);
    return onA[0]!;
  }
  const lesson = (name: string) => async (e: Engine) => ((await on(e)("GET", "/course")) as Rec[]).filter((l) => l.lessonId === name);

  it("the newest lesson wins when it is pushed second", async () => {
    const a = await newDevice(), b = await newDevice();
    await on(a.eng)("PUT", "/course/l1", { state: "active", answers: "older" });
    await later();
    const newer = await on(b.eng)("PUT", "/course/l1", { state: "done", answers: "newer" });
    await sync(a); await sync(b); await sync(a);
    const row = await converged(a, b, lesson("l1"), "answers", "course_progress");
    expect(row).toMatchObject({ id: newer.id, answers: "newer", state: "done" });
    expect(await replica.waitingCount(a.eng.db)).toBe(0);
    expect(await replica.waitingCount(b.eng.db)).toBe(0);
  });

  it("the newest lesson wins when it is pushed first, and the loser's value stays under its own id", async () => {
    const a = await newDevice(), b = await newDevice();
    const older = await on(a.eng)("PUT", "/course/l2", { answers: "older" });
    await later();
    const newer = await on(b.eng)("PUT", "/course/l2", { answers: "newer" });
    await sync(b); await sync(a); await sync(b);
    expect((await converged(a, b, lesson("l2"), "answers", "course_progress"))).toMatchObject({ id: newer.id, answers: "newer" });
    // never moved to the winner's id: the loser's envelope still opens for the loser's row only
    const kept = (await server.db.admin.query("SELECT answers, deleted_at FROM course_progress WHERE id = $1", [older.id])).rows[0];
    expect(kept.deleted_at).not.toBeNull();
    expect(await unsealColumn(kept.answers, KEY, "course_progress", "answers", older.id)).toBe("older");
    await expect(unsealColumn(kept.answers, KEY, "course_progress", "answers", newer.id)).rejects.toBeInstanceOf(SealError);
  });

  it("settles on pull too, whichever side's unsent row is newer", async () => {
    // here the newer row is unsent on b when the older one arrives
    let a = await newDevice(), b = await newDevice();
    await on(a.eng)("PUT", "/course/l3", { answers: "older" });
    await sync(a);
    await later();
    const newer = await on(b.eng)("PUT", "/course/l3", { answers: "newer" });
    await pull(b);
    expect((await lesson("l3")(b.eng)).map((l) => l.id)).toEqual([newer.id]);
    await sync(b); await sync(a);
    expect((await converged(a, b, lesson("l3"), "answers", "course_progress")).id).toBe(newer.id);

    // and here the older row is unsent on b when the newer one arrives: b's row goes, and b says so
    a = await newDevice(); b = await newDevice();
    const older = await on(b.eng)("PUT", "/course/l4", { answers: "older" });
    await later();
    const winner = await on(a.eng)("PUT", "/course/l4", { answers: "newer" });
    await sync(a);
    await pull(b);
    expect((await lesson("l4")(b.eng)).map((l) => l.id)).toEqual([winner.id]);
    await sync(b); await sync(a);
    expect((await converged(a, b, lesson("l4"), "answers", "course_progress")).id).toBe(winner.id);
    expect((await server.db.admin.query("SELECT deleted_at FROM course_progress WHERE id = $1", [older.id])).rows[0].deleted_at).not.toBeNull();
  });

  it("settles a link the same way", async () => {
    const a = await newDevice();
    const night = await on(a.eng)("POST", "/nights", { date: "2026-04-04" });
    const dream = await on(a.eng)("POST", "/dreams", { nightId: night.id, text: "a dream" });
    const element = await on(a.eng)("POST", "/elements", { name: "a cat" });
    await sync(a);
    const b = await newDevice();
    await on(a.eng)("POST", `/dreams/${dream.id}/elements`, { elementId: element.id, span: "older" });
    await later();
    const newer = await on(b.eng)("POST", `/dreams/${dream.id}/elements`, { elementId: element.id, span: "newer" });
    await sync(a); await sync(b); await sync(a);
    const links = (e: Engine) => on(e)("GET", `/dreams/${dream.id}`).then((x) => x.elements as Rec[]);
    expect(await converged(a, b, links, "span", "dream_elements")).toMatchObject({ id: newer.id, span: "newer" });
  });
});

describe("a file that says it is sealed", () => {
  const file = (tables: Rec) => ({ mode: "merge", data: { app: "somnium", sealed: true, tables } });

  it("is refused on the device when a sealed column holds anything else, and nothing is sent", async () => {
    const id = uuidv7();
    const sent: unknown[] = [];
    const send = async (body: Rec) => { const out = await sealRequest("POST", "/import", body, KEY, NEVER); sent.push(out); };
    for (const tables of [{ dreams: [{ id, text: "IN THE CLEAR" }] }, { dreams: { [id]: { text: "IN THE CLEAR" } } }, { dreams: ["IN THE CLEAR"] }]) {
      await expect(send(file(tables))).rejects.toBeInstanceOf(SealError);
      await expect(send(file(tables))).rejects.toThrow(/Nothing was sent/);
    }
    // one bad column in one row among good ones is enough
    const good = await sealColumn("fine", KEY, "dreams", "text", id);
    await expect(send(file({ dreams: [{ id, text: good }, { id: uuidv7(), title: "IN THE CLEAR" }] }))).rejects.toBeInstanceOf(SealError);
    expect(sent).toEqual([]);
  });

  it("goes as it is when it really is sealed", async () => {
    const id = uuidv7();
    const body = file({ dreams: [{ id, text: await sealColumn("fine", KEY, "dreams", "text", id), title: null, lucid: true }], goals: [{ id: uuidv7(), target: 3 }] });
    expect(await sealRequest("POST", "/import", body, KEY, NEVER)).toBe(body);
  });
});

describe("a sealed value without an id, on the routes where the server finds the row", () => {
  let night: Rec, dream: Rec, element: Rec;
  beforeAll(async () => {
    night = await S()("POST", "/nights", { date: "2026-05-05" });
    dream = await S()("POST", "/dreams", { nightId: night.id, lucid: true });
    element = await S()("POST", "/elements", { kind: "theme" });
  });

  it("is refused on a lesson, and accepted with the row's id", async () => {
    const id = uuidv7();
    const answers = await sealColumn("first", KEY, "course_progress", "answers", id);
    await S()("PUT", "/course/sealed-1", { id, answers });
    const next = await sealColumn("second", KEY, "course_progress", "answers", id);
    await expect(S()("PUT", "/course/sealed-1", { answers: next })).rejects.toMatchObject({ status: 400 });
    expect((await S()("GET", "/course")).find((l: Rec) => l.lessonId === "sealed-1").answers).toBe(answers);
    // nothing sealed: nothing to bind, no id needed
    await S()("PUT", "/course/sealed-1", { state: "done" });
    expect((await S()("PUT", "/course/sealed-1", { id, answers: next })).answers).toBe(next);
  });

  it("is refused on a link, and linking again keeps what it doesn't name", async () => {
    const path = `/dreams/${dream.id}/elements`, id = uuidv7();
    const span = await sealColumn("the span", KEY, "dream_elements", "span", id);
    const link = await S()("POST", path, { id, elementId: element.id, span, source: "detected", confidence: 0.5 });
    const other = await sealColumn("other", KEY, "dream_elements", "span", id);
    await expect(S()("POST", path, { elementId: element.id, span: other })).rejects.toMatchObject({ status: 400 });
    // again without a span: the stored span, source and confidence stay
    expect(await S()("POST", path, { elementId: element.id, confidence: 0.9 })).toMatchObject({ id: link.id, span, source: "detected", confidence: 0.9 });
    expect(await S()("POST", path, { elementId: element.id })).toMatchObject({ id: link.id, span, source: "detected", confidence: 0.9 });
    // saying "no span" is still possible
    expect((await S()("POST", path, { elementId: element.id, span: null })).span).toBeNull();
  });
});

describe("paths", () => {
  it("are read the way the server's router reads them, so odd spellings don't skip the key check and sealing", async () => {
    for (const p of ["/dreams/", "//dreams", "/dreams//", "/dreams//x", "/nights/x/", "/course/a/", "/import/", "/export/", "/dreams/x//elements", "/./dreams", "/x/../dreams", "/dreams/?a=1", "/dreams#x"])
      expect(isJournalRoute(p), p).toBe(true);
    for (const p of ["/settings/", "//goals", "/import/preview/", "/dreams/a/b"]) expect(isJournalRoute(p), p).toBe(false);
    const out = await sealRequest("POST", "/dreams/", { nightId: uuidv7(), text: "IN THE CLEAR" }, KEY, NEVER) as Rec;
    expect(isSealed(out.text)).toBe(true);
    const imported = await sealRequest("POST", "//import/", { data: { app: "somnium", tables: { dreams: [{ id: uuidv7(), text: "IN THE CLEAR" }] } } }, KEY, NEVER) as Rec;
    expect(isSealed(imported.data.tables.dreams[0].text)).toBe(true);
  });
});

describe("a direct export", () => {
  it("leaves out a row that doesn't open, and says how many", async () => {
    const good = uuidv7(), bad = uuidv7();
    const tables = { dreams: [
      { id: good, text: await sealColumn("opens", KEY, "dreams", "text", good) },
      { id: bad, text: await sealColumn("doesn't", OTHER_KEY, "dreams", "text", bad) },
    ], goals: [{ id: uuidv7(), target: 2 }] };
    const res = await openResponse("/export", { app: "somnium", sealed: true, tables }, KEY) as { data: Rec; unopened: number };
    expect(res.unopened).toBe(1);
    expect(res.data.unopened).toBe(1);
    expect(res.data.sealed).toBe(false);
    expect(res.data.tables.dreams).toEqual([{ id: good, text: "opens" }]);
    expect(res.data.tables.goals).toHaveLength(1);
    // nothing wrong: nothing said
    const clean = await openResponse("/export", { app: "somnium", sealed: true, tables: { dreams: [tables.dreams[0]] } }, KEY) as { data: Rec; unopened: number };
    expect(clean.unopened).toBe(0);
    expect("unopened" in clean.data).toBe(false);
  });
});
