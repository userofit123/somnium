// Offline use for server accounts: the app works on a copy of your data in this device's own database (PGlite,
// the same engine the server runs), so everything keeps working without a connection or while the server is down.
// Every change is saved here first and sent to the server when it can be reached; changes made on your other
// devices come back the same way. The newest change to a row wins (packages/engine/src/sync).
import { reactive } from "vue";
import { ApiError, httpTransport, server, setTransport, type Transport } from "./client";
import { invalidate, setRemoteHandler } from "./live";
import { readStr, writeStr } from "../core/prefs";
import { keyring } from "../core/keyring";
import { LockedError, allowedWithoutKey, needsKey } from "@somnium/engine/sealed-api";
import { COPY_OWNER_HEADER, COPY_OWNER_REFUSED, leftByOthers, leftWithNothingUnsent } from "@somnium/shared";
import { forgetCachedMedia } from "./media";

// sealed: the journal key is open here, so sealed tables can leave (sealed) and arrive (opened). Without it the pill
// says "Not syncing · locked": settings, goals and reminders still travel, the journal's rows wait, plaintext never
// goes out and ciphertext never comes in (packages/engine/src/sync/sealing.ts).
export const sync = reactive({ on: false, online: true, syncing: false, waiting: 0, lastAt: 0, error: "", sealed: true });
const LOCKED = "Not syncing: the journal key isn't open on this device";
const locked = () => { sync.sealed = false; sync.error = LOCKED; };

// what only the server can do: signing in, the admin pages, files, and sync itself
const SERVER_ONLY = /^\/(auth|admin|media|upload|share|version|update-check|events|sync)(\/|\?|$)/;
const PAGE_WAIT = 30_000;
// A failed sync isn't shown as Offline at once: coming back to the app after another one, the phone often hasn't got
// its connection back yet (or a request cut off while the app was in the background fails as it wakes up), and a
// moment later all is well. Only failures that go on this long, retried every RETRY_WAIT, count as offline.
const OFFLINE_GRACE = 5_000, RETRY_WAIT = 1_500;

let eng: any = null, R: any = null, db: any = null, userId = "", name = "";
let running = false, again = false, timer: ReturnType<typeof setTimeout> | null = null;
// when the current run of failures began (0 = the last sync worked), and when the app was last brought back
let failingSince = 0, shownAt = 0;
// what signing out has to undo, so the next person signing in on this tab starts clean
let releaseLock = () => {}, stopEvents: AbortController | null = null, tick: ReturnType<typeof setInterval> | null = null, stopKeyring = () => {};

// whether this device has changes the server hasn't got, kept outside the copy so it's known before the copy opens
const UNSENT = () => "somniumUnsent:" + name;
const noteUnsent = (n: number) => writeStr(UNSENT(), String(n));
const copyName = (userId: string) => `somnium-r-${hash(server.value.base || location.origin)}-${userId}`;

/**
 * Whether the app must wait for the copy on this device before showing anything. Normally the screens show straight
 * from the server while the copy opens; but with changes here the server hasn't got yet (a dream written just before
 * the app was closed), the server's view is out of date, and anything done to that row there would then beat the
 * change made here.
 */
export async function copyHasUnsent(user: { id: string }): Promise<boolean> {
  const n = copyName(user.id), v = readStr("somniumUnsent:" + n, "");
  if (v) return v !== "0";
  // not known yet (the copy was made by an older version of the app): wait whenever there is a copy
  try { return !!(await (indexedDB as any).databases?.())?.some((d: any) => d.name === `/pglite/${n}`); } catch { return false; }
}

const hash = (s: string) => { let h = 5381; for (const c of s) h = ((h << 5) + h + c.charCodeAt(0)) >>> 0; return h.toString(36); };
/** Deletes a database and waits until it's gone (or blocked by a tab that still has it open), so a reload after it doesn't find it again. */
export function dropDatabase(dbName: string) {
  return new Promise<void>((done) => {
    try { const r = indexedDB.deleteDatabase(dbName); r.onsuccess = r.onerror = r.onblocked = () => done(); } catch { done(); }
  });
}
/** Deletes every copy this device keeps of a server's data (a server account removed from the app). */
export async function eraseCopiesOf(base: string) {
  const start = `/pglite/somnium-r-${hash(base)}-`;
  try {
    for (const d of (await (indexedDB as any).databases?.()) ?? []) if (d.name?.startsWith(start)) { await dropDatabase(d.name); writeStr("somniumUnsent:" + d.name.slice(8), "0"); }
  } catch { /* nothing kept */ }
}
/** A request about this copy: it says whose copy it is, and the server refuses it under anyone else's session. */
const http = <T = any>(owner: string, method: string, path: string, body?: unknown, wait?: number) =>
  httpTransport.request(method, path, body, { wait, headers: { [COPY_OWNER_HEADER]: owner } }) as Promise<T>;
const refusedAsNotOwner = (e: unknown) => e instanceof ApiError && e.status === COPY_OWNER_REFUSED;
/** The server says the session is someone else's now (another tab signed in). A copy still wanted starts over, as the storage event in session.ts does. */
function sessionMovedOn(mineEra: number) {
  if (mineEra !== era) return; // already given up: whoever is signed in on this tab carries on undisturbed
  leaveCopy();
  location.reload();
}
/** Work on a copy stopped between two steps: it was given up, or the journal locked. */
class Stopped extends Error {}

const transport: Transport = {
  async request(method, path, body, opts) {
    if (SERVER_ONLY.test(path) || body instanceof Blob) return httpTransport.request(method, path, body, opts);
    // your name lives with your sign-in on the server; the copy here follows it
    if (method === "PUT" && path === "/me") {
      const r = await httpTransport.request(method, path, body);
      await eng.handle({ method, path, body, userId }).catch(() => {});
      return r;
    }
    const [p, qs] = path.split("?");
    // the copy holds the journal opened (plaintext), so it answers only while the key is open here, like the server's
    // path does (sealingTransport in client.ts): every screen is gone while locked, but other code (reminders) still runs
    if (!keyring.isOpen() && !allowedWithoutKey(method, p!, body)) throw new LockedError();
    const r = await eng.handle({ method, path: p, query: Object.fromEntries(new URLSearchParams(qs ?? "")), body, userId });
    if (r.status === 404 && r.body?.error === "Not found") return httpTransport.request(method, path, body); // not one of the engine's
    if (r.status !== 200) throw new ApiError(r.status, r.body?.error ?? "Something went wrong");
    return r.body;
  },
};

// Opening and closing a copy take a while and share the variables above, so they happen strictly one after the other.
// `era` moves on the moment a copy is given up: an opening still under way then knows it is no longer wanted.
let era = 0, lifecycle: Promise<unknown> = Promise.resolve();
const inTurn = <T>(step: () => Promise<T>): Promise<T> => { const p = lifecycle.then(step); lifecycle = p.catch(() => {}); return p; };

/** Whose copy this tab is working on, if any. */
export const copyOpenFor = (): string | null => (sync.on && userId ? userId : null);

/** One database per server and person. False when this browser can't (or another tab already has it open). */
export function startReplica(user: { id: string }): Promise<boolean> {
  const mine = era;
  return inTurn(() => (mine === era ? openCopy(user, mine) : Promise.resolve(false)));
}
async function openCopy(user: { id: string }, mineEra: number): Promise<boolean> {
  if (sync.on) { if (user.id === userId) return true; location.reload(); return false; } // signed in again (or as someone else)
  if (!globalThis.indexedDB || !globalThis.WebAssembly || !navigator.locks) return false;
  name = copyName(user.id);
  // PGlite can't share its database between tabs: the first tab works offline, others talk to the server directly
  const mine = await new Promise<boolean>((ok) => {
    navigator.locks.request(name, { ifAvailable: true }, (lock) => { ok(!!lock); return lock ? new Promise<void>((done) => { releaseLock = done; }) : undefined; });
  });
  if (!mine) return false;
  try {
    const [{ createEngine, replica }, { pgliteDb }] = await Promise.all([import("@somnium/engine"), import("@somnium/engine/pglite")]);
    R = replica;
    db = await pgliteDb(`idb://${name}`);
    eng = await createEngine(db, { mode: "local", seed: false });
    userId = user.id;
    const goOn = () => { if (mineEra !== era) throw new Stopped(); };
    goOn();
    if (!(await R.replicaMeta(db)).ready) {
      // the first copy needs the server once, and the key to open it: without the key there is no copy to work on
      if (!keyring.isOpen()) { locked(); throw new Error(LOCKED); }
      const opened = keyring.generation();
      goOn();
      // everything you have in one answer: on a big history and a slow connection this takes far longer than an
      // ordinary request is given. No copy of the key while waiting for it: it is taken for the one step that needs it.
      const snapshot = await http(user.id, "GET", "/sync/snapshot", undefined, 120_000);
      goOn();
      const key = keyring.generation() === opened ? keyring.get() : null;
      if (!key) { locked(); throw new Error(LOCKED); }
      try { await R.loadSnapshot(db, snapshot, key); } finally { key.fill(0); }
    }
  } catch (e) {
    if (refusedAsNotOwner(e)) sessionMovedOn(mineEra);
    await db?.close().catch(() => {}); db = null; eng = null;
    releaseLock();
    return false;
  }
  // a change here is unsent until a sync says otherwise: noted at once, in case the app is closed before that
  eng.onChange((_u: string, topics: string[]) => { noteUnsent(1); invalidate(topics); schedule(); });
  // catch up with the server before the screens switch to the copy: otherwise they briefly show what the copy had
  // when the app was last open (a dream written on another device since, say) and then change again.
  // Bounded, so a slow connection still gets the copy within a few seconds; the sync carries on behind it.
  // Not when the server has just failed to answer (the app is opening offline): the sync below tries again anyway.
  if (mineEra === era && navigator.onLine && sync.online) await Promise.race([run(mineEra), new Promise((ok) => setTimeout(ok, 4000))]);
  // given up while opening (the session ended): this must not become the transport of whoever signs in next
  if (mineEra !== era) { await closeCopy(); return false; }
  setTransport(transport);
  setRemoteHandler(() => schedule(0));
  sync.on = true;
  stopEvents = new AbortController();
  const { signal } = stopEvents;
  addEventListener("online", () => schedule(0), { signal });
  addEventListener("offline", () => unreachable(), { signal });
  // whatever failed while the app was in the background (the phone cuts its network) says nothing about now
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { failingSince = 0; shownAt = Date.now(); schedule(0); } }, { signal });
  tick = setInterval(() => schedule(0), PAGE_WAIT);
  // the key arriving (sign-in finishing, the app unlocking) is what a locked sync was waiting for
  stopKeyring = keyring.onChange((open) => { if (open) { sync.sealed = true; if (sync.error === LOCKED) sync.error = ""; schedule(0); } else locked(); });
  sync.waiting = await R.waitingCount(db);
  noteUnsent(sync.waiting);
  schedule(0);
  return true;
}

export function schedule(ms = 400) {
  if (!sync.on) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void run(era), ms);
}

/** Send what changed here, then fetch what changed elsewhere. */
async function run(mineEra: number) {
  if (running) { again = true; return; }
  // No key: sealed tables can neither be sealed for the server nor opened from it, so only the plain ones travel.
  const keyed = keyring.isOpen(), opened = keyring.generation(), owner = userId;
  if (!keyed) locked();
  running = true; sync.syncing = true;
  // Before every step: this copy may have been given up (the session ended, someone else signed in), and a lock or
  // another sign-in moves the key on. A step already running ends first, but nothing new starts.
  const goOn = () => { if (mineEra !== era || (keyed && keyring.generation() !== opened)) throw new Stopped(); };
  // each step that seals or opens has its own copy of the key, zeroed as it ends, so none is held while waiting for the
  // server. It is never zeroed sooner: rows still being sealed with it would be sealed with zeros.
  const withKey = async (step: (key: Uint8Array) => Promise<any>): Promise<any> => {
    goOn();
    const key = keyring.get();
    if (!key) throw new Stopped();
    try { return await step(key); } finally { key.fill(0); }
  };
  // when the request now in flight began: the grace counts from there, not from the start of a long sync
  let tried = Date.now();
  const call = <T = any>(method: string, path: string, body?: unknown) => { goOn(); tried = Date.now(); return http<T>(owner, method, path, body); };
  let changed = false, failed = 0;
  try {
    const meta = await R.replicaMeta(db);
    if (!keyed) {
      for (;;) {
        const out = await R.plainChanges(db);
        if (!out.changes.length) break;
        const res = await call("POST", "/sync/push", { device: meta.device, changes: out.changes });
        await R.markPlainSent(db, out.upTo);
        if (res.rejected.length) { await R.applyRemote(db, userId, res.rejected.filter((c: any) => !needsKey(c.tbl))); changed = true; }
        if (res.failed?.length) failed = res.failed.length;
      }
      for (;;) {
        const p = await call("GET", `/sync/pull?since=${await R.plainSince(db)}&device=${encodeURIComponent(meta.device)}`);
        await R.takePlain(db, userId, p.changes, p.cursor);
        if (p.changes.some((c: any) => !needsKey(c.tbl))) changed = true;
        if (!p.more) break;
      }
      failingSince = 0;
      sync.online = true;
      return;
    }
    for (;;) {
      const out = await withKey((key) => R.localChanges(db, 500, key)); // sealed here, on the way out
      if (!out.changes.length) break;
      const res = await call("POST", "/sync/push", { device: meta.device, changes: out.changes });
      // before marking them sent: stopped here, they are sent again next time and the server's answer comes again.
      if (res.rejected.length) { await withKey((key) => R.applyRemote(db, userId, res.rejected, undefined, key)); changed = true; }
      await R.markSent(db, out.upTo);
      // the server couldn't take some (they no longer fit its data): say so rather than lose them without a word
      if (res.failed?.length) { failed = res.failed.length; console.warn(`Sync: the server refused ${failed} change${failed === 1 ? "" : "s"}`); }
    }
    for (;;) {
      const m = await R.replicaMeta(db);
      const p = await call("GET", `/sync/pull?since=${m.cursor}&device=${encodeURIComponent(m.device)}`);
      // opened here, on the way in. A row that arrived before the row it belongs to is held back and tried again by
      // the engine on every pull, so nothing here has to retry it
      await withKey((key) => R.applyRemote(db, userId, p.changes, p.cursor, key));
      if (p.changes.length) changed = true;
      if (!p.more) break;
    }
    failingSince = 0;
    const after = await R.replicaMeta(db);
    const unopened = after.unopened?.length ?? 0, heldBack = after.heldBack?.length ?? 0;
    const problems = [
      failed ? `${failed} change${failed === 1 ? "" : "s"} from this device didn't fit the server's data` : "",
      unopened ? `${unopened} row${unopened === 1 ? "" : "s"} from the server couldn't be opened` : "",
      heldBack ? `${heldBack} row${heldBack === 1 ? "" : "s"} from the server couldn't be saved yet` : "",
    ].filter(Boolean).join(" · ");
    Object.assign(sync, { online: true, error: problems, lastAt: Date.now() });
  } catch (e) {
    if (e instanceof Stopped) { if (!keyring.isOpen() && mineEra === era) locked(); }
    else if (refusedAsNotOwner(e)) sessionMovedOn(mineEra);
    else if (e instanceof ApiError && e.status === 0) unreachable(tried);
    else if ((e as Error).name === "LockedError") locked();
    else {
      // the server answered (with an error), so it is reachable: a later network failure gets its own grace
      failingSince = 0;
      sync.error = (e as Error).message;
    }
  } finally {
    sync.waiting = await R.waitingCount(db).catch(() => sync.waiting);
    noteUnsent(sync.waiting);
    running = false; sync.syncing = false;
    if (changed) invalidate(["*"]);
    if (again) { again = false; schedule(0); }
  }
}

/** The server didn't answer (or the device says it has no network): Offline once that has lasted OFFLINE_GRACE. */
export function unreachable(since = Date.now()) {
  // in the background the pill isn't seen, and the failure may only be the phone holding back the network
  if (document.visibilityState !== "visible" || !sync.online) return;
  const now = Date.now();
  // from when the failed try began (a server that never answers has already had 20 s), but not from before the app
  // came back: a request sent before going away that fails on the way back counts only from now
  if (!failingSince) failingSince = Math.max(since, shownAt);
  if (now - failingSince >= OFFLINE_GRACE) sync.online = false;
  else schedule(RETRY_WAIT);
}

// A sync under way writes to this database, and its step in progress may hold a copy of the key. It has to end before the
// database closes and before anyone else can open theirs. It can't go on for long: once the copy is given up it starts no
// further step, whoever's session is live now, so what remains is the request or step already under way. The server
// refuses such a request under anyone else's session.
async function closeCopy() {
  while (running) await new Promise((ok) => setTimeout(ok, 50));
  again = false;
  await db?.close().catch(() => {});
  db = null; eng = null; userId = ""; failingSince = 0; Object.assign(sync, { waiting: 0, error: "", syncing: false, sealed: true });
  releaseLock(); releaseLock = () => {};
}

/** Leaves the copy at once: from here on every request goes to the server. What remains is closing it, in turn. */
function leaveCopy(): boolean {
  era++;
  const wasOn = sync.on;
  sync.on = false;
  // back to the server for everything: left pointing at the closed copy, the next account to sign in on this tab
  // would get "PGlite is closed" on every screen, or worse, read this person's journal
  setTransport(httpTransport);
  setRemoteHandler(invalidate);
  stopEvents?.abort(); stopEvents = null;
  if (tick) clearInterval(tick); tick = null;
  if (timer) clearTimeout(timer); timer = null;
  stopKeyring(); stopKeyring = () => {};
  return wasOn;
}

/** The session ended without signing out (a 401): the copy stays on the device, closed, for the same person's return. */
export function detachReplica(): Promise<void> {
  const wasOn = leaveCopy();
  return inTurn(async () => { if (wasOn) await closeCopy(); });
}

/** Someone signed in: a copy another person's ended session left on this device goes, unless it holds changes the server
 *  hasn't got. Those wait for that person's next sign-in and unlock, which sends them.
 *  True when a page still holds one being deleted: that only goes through once the page has reloaded. */
export function eraseCopiesLeftByOthers(user: { id: string }): Promise<boolean> {
  return inTurn(async () => {
    let stillHeld = false;
    const prefix = `/pglite/somnium-r-${hash(server.value.base || location.origin)}-`;
    let names: string[] = [];
    try { names = ((await (indexedDB as any).databases?.()) ?? []).map((d: any) => String(d.name)); } catch { /* nothing to list */ }
    const left = leftByOthers(names, prefix, user.id);
    const erase = leftWithNothingUnsent(left, (n) => readStr("somniumUnsent:" + n.slice(8), ""));
    for (const n of erase) { if (await dropCopy(n)) stillHeld = true; else writeStr("somniumUnsent:" + n.slice(8), "0"); }
    // a kept copy's photos stay too: they are sealed, and that person may come back offline
    if (erase.length && erase.length === left.length) await forgetCachedMedia();
    return stillHeld;
  });
}

/** Signing out: this person's copy on this device goes too (another person may use it next), whether or not this tab
 *  had got as far as opening it. True when a page still holds it: the deletion goes through once that page reloads. */
export function eraseReplica(user?: { id: string }): Promise<boolean> {
  const wasOn = leaveCopy();
  const gone = user ? copyName(user.id) : name;
  return inTurn(async () => {
    if (wasOn) await closeCopy();
    const stillHeld = await dropCopy(`/pglite/${gone}`);
    writeStr("somniumUnsent:" + gone, "0");
    return stillHeld;
  });
}
// PGlite's close() leaves its IndexedDB connection open for as long as the page lives, so deleting a copy this page has
// used waits until the page is gone, and meanwhile opening that same copy would wait behind the deletion. True: it waits.
function dropCopy(dbName: string) {
  return new Promise<boolean>((done) => {
    try { const r = indexedDB.deleteDatabase(dbName); r.onsuccess = r.onerror = () => done(false); r.onblocked = () => done(true); } catch { done(false); }
  });
}
