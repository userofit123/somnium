// LDJ-52: two devices that log the same night while offline. The night made first survives (created_at, then id);
// the other is soft-deleted with merged_into, its dreams move over (only night_id changes), and a device holding the
// key copies its fields into the survivor: differing free text is joined (survivor's first), technique lists are
// joined, other plain values go newest updated_at first. Also: a lesson or link deleted on one
// device while another holds a live duplicate under another id.
import { describe, it, expect, beforeAll } from "vitest";
import { newDataKey, isSealed, unsealColumn, SealError } from "@somnium/shared";
import { createEngine, replica, type Engine } from "../src/index";
import { mergeNightFields, joinText } from "../src/sync/core";
import { pgliteDb } from "../src/adapters/pglite";
import { uuidv7 } from "../src/ids";
import { SEALED_COLUMNS } from "../src/sealed";

const KEY = newDataKey();
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
// one round of what the app does: send what changed here (taking the push's answer), then fetch what changed elsewhere.
// Nothing may fail, be held back or stay unopened.
async function sync(d: Device) {
  for (;;) {
    const out = await replica.localChanges(d.eng.db, 500, KEY);
    if (!out.changes.length) break;
    const res = await S()("POST", "/sync/push", { device: d.id, changes: out.changes });
    expect(res.failed).toEqual([]);
    await replica.markSent(d.eng.db, out.upTo);
    if (res.rejected.length) expect((await replica.applyRemote(d.eng.db, U, res.rejected, undefined, KEY)).failed).toEqual([]);
  }
  await pull(d);
}
async function pull(d: Device) {
  for (;;) {
    const m = await replica.replicaMeta(d.eng.db);
    const p = await S()("GET", "/sync/pull", undefined, { since: String(m.cursor), device: d.id });
    const r = await replica.applyRemote(d.eng.db, U, p.changes, p.cursor, KEY);
    expect([r.failed, r.heldBack, r.unopened]).toEqual([[], 0, 0]);
    if (!p.more) break;
  }
}
const settled = async (d: Device) => {
  const m = await replica.replicaMeta(d.eng.db);
  expect([m.heldBack ?? [], m.unopened ?? []]).toEqual([[], []]);
  expect(await replica.waitingCount(d.eng.db)).toBe(0);
};

beforeAll(async () => {
  server = await createEngine(await pgliteDb("memory://"), { mode: "server" });
  U = uuidv7();
  await server.db.admin.query("INSERT INTO users (id, username, display_name) VALUES ($1,'u','U')", [U]);
}, 120000);

describe("two devices that log the same night offline", () => {
  let day = 10;
  async function both(order: "first-made pushed first" | "first-made pushed second") {
    const date = `2026-06-${day++}`;
    // c is a third device that was signed in all along and only pulls; it is checked at the end, with one made afterwards
    const a = await newDevice(), b = await newDevice(), c = await newDevice();
    const na = await on(a.eng)("POST", "/nights", { date, notes: "notes from a", sleepQuality: 2, techniquesPlanned: ["mild"] });
    const da = await on(a.eng)("POST", "/dreams", { nightId: na.id, text: "the dream a wrote" });
    await later();
    const nb = await on(b.eng)("POST", "/nights", { date, notes: "notes from b", intention: "look at my hands", sleepQuality: 4, wbtbUsed: true, techniquesPlanned: ["wbtb", "mild"] });
    const db = await on(b.eng)("POST", "/dreams", { nightId: nb.id, text: "the dream b wrote" });
    await later();
    // b goes on writing under its own night while still offline, after the night was made
    const db2 = await on(b.eng)("POST", "/dreams", { nightId: nb.id, text: "a second dream on b" });

    const [first, second] = order === "first-made pushed first" ? [a, b] : [b, a];
    await sync(first); await sync(second); await sync(first); await sync(second); await sync(first);
    await pull(c);
    const d = await newDevice();
    for (const x of [a, b, c, d]) await settled(x);
    return { a, b, c, d, na, nb, dreams: [da, db, db2], date };
  }

  async function check(r: Awaited<ReturnType<typeof both>>) {
    const { na, nb, dreams, date } = r;
    for (const x of [r.a, r.b, r.c, r.d]) {
      const nights = ((await on(x.eng)("GET", "/nights")) as Rec[]).filter((n) => n.date === date);
      // one live night, the one made first, holding every dream with its text readable
      expect(nights.map((n) => n.id)).toEqual([na.id]);
      // both people's words survive, the survivor's first; plain values newest first; technique lists joined
      expect(nights[0]).toMatchObject({ notes: BOTH, intention: "look at my hands", sleepQuality: 4, wbtbUsed: true, techniquesPlanned: ["mild", "wbtb"] });
      const night = await on(x.eng)("GET", `/nights/${na.id}`);
      expect((night.dreams as Rec[]).map((d) => d.id).sort()).toEqual(dreams.map((d) => d.id).sort());
      expect((night.dreams as Rec[]).map((d) => d.text).sort()).toEqual(["a second dream on b", "the dream a wrote", "the dream b wrote"]);
      const gone = (await x.eng.db.admin.query("SELECT deleted_at, merged_into, absorbed FROM nights WHERE id = $1", [nb.id])).rows[0];
      expect(gone).toMatchObject({ merged_into: na.id, absorbed: true });
      expect(gone.deleted_at).not.toBeNull();
    }
    // the server: one live night for the date, every dream under it, nothing in the clear
    const live = (await server.db.admin.query("SELECT * FROM nights WHERE user_id = $1 AND date = $2 AND deleted_at IS NULL", [U, date])).rows;
    expect(live.map((n: Rec) => n.id)).toEqual([na.id]);
    const sv = live[0]!;
    for (const col of SEALED_COLUMNS.nights!) if (sv[col] != null) expect(isSealed(sv[col])).toBe(true);
    // the joined notes (b's part included) were sealed again for the survivor's id, and open only for it
    expect(await unsealColumn(sv.notes, KEY, "nights", "notes", na.id)).toBe(BOTH);
    expect(await unsealColumn(sv.intention, KEY, "nights", "intention", na.id)).toBe("look at my hands");
    await expect(unsealColumn(sv.notes, KEY, "nights", "notes", nb.id)).rejects.toBeInstanceOf(SealError);
    // b's night stays under its own id, its own notes still opening for it
    const loser = (await server.db.admin.query("SELECT notes, deleted_at, merged_into FROM nights WHERE id = $1", [nb.id])).rows[0];
    expect(loser.merged_into).toBe(na.id);
    expect(await unsealColumn(loser.notes, KEY, "nights", "notes", nb.id)).toBe("notes from b");
    const ds = (await server.db.admin.query("SELECT id, night_id, text FROM dreams WHERE id = ANY($1::uuid[])", [dreams.map((d) => d.id)])).rows;
    expect(ds).toHaveLength(3);
    for (const d of ds) {
      expect(d.night_id).toBe(na.id);
      expect(isSealed(d.text)).toBe(true);
      expect(await unsealColumn(d.text, KEY, "dreams", "text", d.id)).toMatch(/dream/);
    }
  }

  const BOTH = "notes from a\n\nnotes from b";
  /** Merging is done once and changes nothing when it comes round again: more syncs don't double the text. */
  async function again(r: Awaited<ReturnType<typeof both>>) {
    for (const x of [r.a, r.b, r.c, r.d, r.a, r.b]) await sync(x);
    for (const x of [r.a, r.b, r.c, r.d]) await settled(x);
    // and even a device that merged the same two nights again from scratch would leave the joined text as it is
    const rows = (await r.a.eng.db.admin.query("SELECT to_jsonb(n) AS r FROM nights n WHERE id = ANY($1::uuid[])", [[r.na.id, r.nb.id]])).rows.map((x: any) => x.r);
    const sv = rows.find((n: Rec) => n.id === r.na.id), lo = rows.find((n: Rec) => n.id === r.nb.id);
    expect(mergeNightFields(sv, lo)).toEqual({});
    await check(r);
  }

  it("ends with one night holding every dream when the night made first is pushed first", async () => {
    const r = await both("first-made pushed first");
    await check(r);
    await again(r);
  });

  it("ends the same when the night made first is pushed second", async () => {
    const r = await both("first-made pushed second");
    await check(r);
    await again(r);
  });

  it("joins differing text, keeps the longer when one holds the other, and joins technique lists", () => {
    expect(joinText("a", "b")).toBe("a\n\nb");
    expect(joinText("tea and a walk", "tea")).toBe("tea and a walk");
    expect(joinText("tea", "tea and a walk")).toBe("tea and a walk");
    const s = { updated_at: "2026-01-02T00:00:00Z", notes: "mine", substances: "tea", intention: null, sleep_quality: 3, techniques_done: ["mild"] };
    const l = { updated_at: "2026-01-01T00:00:00Z", notes: "theirs", substances: "tea", intention: "fly", sleep_quality: 5, techniques_done: ["wild", "mild"] };
    // the loser is older: its rating loses, but none of its words do
    expect(mergeNightFields(s, l)).toEqual({ notes: "mine\n\ntheirs", intention: "fly", techniques_done: ["mild", "wild"] });
    expect(mergeNightFields({ ...s, notes: "mine\n\ntheirs", intention: "fly", techniques_done: ["mild", "wild"] }, l)).toEqual({});
  });

  it("keeps a field only the survivor has, and both nights' notes when they differ", async () => {
    const a = await newDevice(), b = await newDevice();
    const date = "2026-07-01";
    const nb = await on(b.eng)("POST", "/nights", { date, notes: "older notes from b", substances: "tea" });
    await later();
    const na = await on(a.eng)("POST", "/nights", { date, notes: "newer notes from a" });
    // b's night was made first and survives: its notes come first, a's follow, and b's substances stay
    // b copies a's notes in when it hears of the merge, and sends that on its next round
    await sync(a); await sync(b); await sync(a); await sync(b); await sync(a);
    for (const x of [a, b]) {
      const n = ((await on(x.eng)("GET", "/nights")) as Rec[]).filter((v) => v.date === date);
      expect(n.map((v) => v.id)).toEqual([nb.id]);
      expect(n[0]).toMatchObject({ notes: "older notes from b\n\nnewer notes from a", substances: "tea" });
      await settled(x);
    }
    expect((await server.db.admin.query("SELECT merged_into FROM nights WHERE id = $1", [na.id])).rows[0].merged_into).toBe(nb.id);
    // both texts live on the server only as the survivor's ciphertext, opening for its id
    const sv = (await server.db.admin.query("SELECT notes FROM nights WHERE id = $1", [nb.id])).rows[0];
    expect(isSealed(sv.notes)).toBe(true);
    expect(await unsealColumn(sv.notes, KEY, "nights", "notes", nb.id)).toBe("older notes from b\n\nnewer notes from a");
  });

  it("leaves naps alone", async () => {
    const a = await newDevice(), b = await newDevice();
    const date = "2026-07-02";
    await on(a.eng)("POST", "/nights", { date });
    await on(b.eng)("POST", "/nights", { date, nap: true });
    await sync(a); await sync(b); await sync(a);
    expect(((await on(a.eng)("GET", "/nights")) as Rec[]).filter((v) => v.date === date)).toHaveLength(2);
  });
});

describe("a lesson or link deleted on one device while another holds a live duplicate", () => {
  const lesson = (name: string) => async (e: Engine) => ((await on(e)("GET", "/course")) as Rec[]).filter((l) => l.lessonId === name);

  it("the deletion wins when it is newer than the duplicate, in either push order", async () => {
    for (const [name, deleterFirst] of [["del-1", true], ["del-2", false]] as const) {
      const a = await newDevice(), b = await newDevice();
      await on(b.eng)("PUT", `/course/${name}`, { answers: "b's copy" });
      await later();
      await on(a.eng)("PUT", `/course/${name}`, { answers: "a's copy" });
      await later();
      await on(a.eng)("DELETE", `/course/${name}`);
      if (deleterFirst) { await sync(a); await sync(b); await sync(a); } else { await sync(b); await sync(a); await sync(b); }
      for (const e of [a.eng, b.eng, server]) expect(await lesson(name)(e)).toEqual([]);
      for (const x of [a, b]) await settled(x);
    }
  });

  it("a duplicate changed after the deletion stays", async () => {
    for (const [name, deleterFirst] of [["del-3", true], ["del-4", false]] as const) {
      const a = await newDevice(), b = await newDevice();
      await on(a.eng)("PUT", `/course/${name}`, { answers: "a's copy" });
      await later();
      await on(a.eng)("DELETE", `/course/${name}`);
      await later();
      const kept = await on(b.eng)("PUT", `/course/${name}`, { answers: "b's later copy" });
      if (deleterFirst) { await sync(a); await sync(b); await sync(a); } else { await sync(b); await sync(a); await sync(b); }
      for (const e of [a.eng, b.eng, server]) expect((await lesson(name)(e)).map((l) => l.id)).toEqual([kept.id]);
    }
  });

  it("settles a link the same way", async () => {
    const a = await newDevice();
    const night = await on(a.eng)("POST", "/nights", { date: "2026-07-05" });
    const dream = await on(a.eng)("POST", "/dreams", { nightId: night.id, text: "a dream" });
    const element = await on(a.eng)("POST", "/elements", { name: "a cat" });
    await sync(a);
    const b = await newDevice();
    await on(b.eng)("POST", `/dreams/${dream.id}/elements`, { elementId: element.id, span: "b's link" });
    await later();
    await on(a.eng)("POST", `/dreams/${dream.id}/elements`, { elementId: element.id, span: "a's link" });
    await later();
    await on(a.eng)("DELETE", `/dreams/${dream.id}/elements/${element.id}`);
    await sync(b); await sync(a); await sync(b);
    for (const e of [a.eng, b.eng, server]) expect((await on(e)("GET", `/dreams/${dream.id}`)).elements).toEqual([]);
  });
});
