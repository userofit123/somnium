// Offline use for server accounts: the app works on a copy of your data in this device's own database (PGlite,
// the same engine the server runs), so everything keeps working without a connection or while the server is down.
// Every change is saved here first and sent to the server when it can be reached; changes made on your other
// devices come back the same way. The newest change to a row wins (packages/engine/src/sync).
import { reactive } from "vue";
import { ApiError, httpTransport, server, setTransport, type Transport } from "./client";
import { invalidate, setRemoteHandler } from "./live";
import { readStr, writeStr } from "../core/prefs";
import { keyring } from "../core/keyring";

// sealed: the journal key is open here, so sealed tables can leave (sealed) and arrive (opened). Without it nothing is
// sent or fetched and the pill says Locked: the copy keeps working offline, plaintext never goes out, ciphertext never
// comes in (packages/engine/src/sync/sealing.ts).
export const sync = reactive({ on: false, online: true, syncing: false, waiting: 0, lastAt: 0, error: "", sealed: true });
const LOCKED = "Locked: the journal key isn't open on this device";
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
const http = <T = any>(method: string, path: string, body?: unknown) => httpTransport.request(method, path, body) as Promise<T>;

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
    const r = await eng.handle({ method, path: p, query: Object.fromEntries(new URLSearchParams(qs ?? "")), body, userId });
    if (r.status === 404 && r.body?.error === "Not found") return httpTransport.request(method, path, body); // not one of the engine's
    if (r.status !== 200) throw new ApiError(r.status, r.body?.error ?? "Something went wrong");
    return r.body;
  },
};

/** One database per server and person. False when this browser can't (or another tab already has it open). */
export async function startReplica(user: { id: string }): Promise<boolean> {
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
    if (!(await R.replicaMeta(db)).ready) {
      // the first copy needs the server once, and the key to open it: without the key there is no copy to work on
      if (!keyring.get()) { locked(); throw new Error(LOCKED); }
      // everything you have in one answer: on a big history and a slow connection this takes far longer than an
      // ordinary request is given
      await R.loadSnapshot(db, await httpTransport.request("GET", "/sync/snapshot", undefined, { wait: 120_000 }), keyring.get());
    }
  } catch {
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
  if (navigator.onLine && sync.online) await Promise.race([run(), new Promise((ok) => setTimeout(ok, 4000))]);
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
  stopKeyring = keyring.onChange((k) => { if (k) { sync.sealed = true; if (sync.error === LOCKED) sync.error = ""; schedule(0); } else locked(); });
  sync.waiting = await R.waitingCount(db);
  noteUnsent(sync.waiting);
  schedule(0);
  return true;
}

export function schedule(ms = 400) {
  if (!sync.on) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(run, ms);
}

/** Send what changed here, then fetch what changed elsewhere. */
async function run() {
  if (running) { again = true; return; }
  // no key, no sync: sealed tables can neither be sealed for the server nor opened from it
  const key = keyring.get();
  if (!key) { locked(); return; }
  running = true; sync.syncing = true;
  // when the request now in flight began: the grace counts from there, not from the start of a long sync
  let tried = Date.now();
  const call = <T = any>(method: string, path: string, body?: unknown) => { tried = Date.now(); return http<T>(method, path, body); };
  let changed = false, failed = 0;
  try {
    const meta = await R.replicaMeta(db);
    for (;;) {
      const out = await R.localChanges(db, 500, key); // sealed here, on the way out
      if (!out.changes.length) break;
      const res = await call("POST", "/sync/push", { device: meta.device, changes: out.changes });
      await R.markSent(db, out.upTo);
      if (res.rejected.length) { await R.applyRemote(db, userId, res.rejected, undefined, key); changed = true; }
      // the server couldn't take some (they no longer fit its data): say so rather than lose them without a word
      if (res.failed?.length) { failed = res.failed.length; console.warn("Sync: the server refused", res.failed); }
    }
    const retry: any[] = [];
    for (;;) {
      const m = await R.replicaMeta(db);
      const p = await call("GET", `/sync/pull?since=${m.cursor}&device=${encodeURIComponent(m.device)}`);
      const r = await R.applyRemote(db, userId, p.changes, p.cursor, key); // opened here, on the way in
      if (p.changes.length) changed = true;
      retry.push(...r.failed.map((f: any) => f.change));
      if (!p.more) break;
    }
    // a row that arrived before the row it belongs to (they came in different pages)
    if (retry.length) await R.applyRemote(db, userId, retry, undefined, key);
    failingSince = 0;
    Object.assign(sync, { online: true, error: failed ? `${failed} change${failed === 1 ? "" : "s"} from this device didn't fit the server's data` : "", lastAt: Date.now() });
  } catch (e) {
    if (e instanceof ApiError && e.status === 0) unreachable(tried);
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

/** Signing out: the copy on this device goes too (another person may use it next). */
export async function eraseReplica() {
  if (!sync.on) return;
  sync.on = false;
  // back to the server for everything: left pointing at the closed copy, the next account to sign in on this tab
  // would get "PGlite is closed" on every screen
  setTransport(httpTransport);
  setRemoteHandler(invalidate);
  stopEvents?.abort(); stopEvents = null;
  if (tick) clearInterval(tick); tick = null;
  if (timer) clearTimeout(timer); timer = null;
  stopKeyring(); stopKeyring = () => {};
  await db?.close().catch(() => {});
  db = null; eng = null; userId = ""; failingSince = 0; Object.assign(sync, { waiting: 0, error: "", syncing: false, sealed: true });
  releaseLock(); releaseLock = () => {};
  await dropDatabase(`/pglite/${name}`);
  writeStr(UNSENT(), "0");
}
