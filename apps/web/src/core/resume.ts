// The reload grace (PLAN.md §4.3, §16 2026-11-15): a browser tab that reloads, or that the browser discarded while it
// was in the background, opens again without the lock screen if it comes back within the lock's delay - as it would
// have stayed open had it not reloaded. "Immediately" means no grace.
//
// The data key is never written anywhere in the clear. While the journal is open, this tab keeps it encrypted
// (AES-GCM) under a key of its own, made with Web Crypto as non-extractable: that key lives in IndexedDB as a CryptoKey
// object (the browser stores it; no script can read its bytes), and the encrypted data key lives in this tab's session
// storage (gone when the tab closes, never shared with other tabs). Leaving the tab - a reload leaves it first - stamps
// when the delay ends. A load reads the stamp once, and opens the key only for the same account inside the delay
// (canResume in @somnium/shared). Either way both halves are deleted, and the journal makes a fresh pair after opening.
// The key dropped (the lock, signing out, another account) deletes them too.
//
// The apps keep locking at every start: they don't reload in normal use, a restart of them is a start, and the desktop
// app locks at once when closed to the tray (LDJ-56).
import { canResume, fromBase64url, randomBytes, resumeUntil, toBase64url, type ResumeMark } from "@somnium/shared";
import { keyring } from "./keyring";

interface Entry extends ResumeMark { iv: string; sealed: string }
const MARK = "somniumResume", DB = "somnium-resume", STORE = "keys";
// a record outlives its tab's last word by this much: a live tab refreshes it every minute (timers in a hidden tab run
// about once a minute), and a load deletes the ones past it, left by tabs that were closed
const KEEP_MS = 5 * 60_000;

const inApp = () => { const g = globalThis as { somniumNative?: unknown; somniumDesktop?: unknown }; return !!g.somniumNative || !!g.somniumDesktop; };
const enc = new TextEncoder();
const buf = (b: Uint8Array) => b.slice().buffer as ArrayBuffer;

function db<T>(fn: (s: IDBObjectStore) => IDBRequest<T>, mode: IDBTransactionMode = "readonly"): Promise<T> {
  return new Promise((res, rej) => {
    const o = indexedDB.open(DB, 1);
    o.onupgradeneeded = () => o.result.createObjectStore(STORE);
    o.onsuccess = () => {
      const d = o.result;
      try {
        const tx = d.transaction(STORE, mode), r = fn(tx.objectStore(STORE));
        tx.oncomplete = () => { d.close(); res(r.result); };
        tx.onerror = tx.onabort = () => { d.close(); rej(tx.error); };
      } catch (e) { d.close(); rej(e); }
    };
    o.onerror = () => rej(o.error);
  });
}
// a storage that never answers must not keep the splash up: no answer in time is a no
const within = <T>(p: Promise<T>, ms = 3000) => Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
const dropRecord = (id: string) => { void db((s) => s.delete(id), "readwrite").catch(() => {}); };

// What the last page of this tab left, taken out of storage as the page starts: one try per load, and nothing left for
// this page's own lock to stumble on.
const found: Entry | null = (() => {
  if (inApp()) return null;
  try {
    const t = sessionStorage.getItem(MARK);
    sessionStorage.removeItem(MARK);
    return t ? (JSON.parse(t) as Entry) : null;
  } catch { return null; }
})();

/** Whether this load may open without the lock screen (the splash stays up while that is decided). */
export const mayResume = (): boolean => typeof found?.until === "number" && found.until > Date.now();

/**
 * The data key the previous page of this tab left, when this account came back within the delay; null otherwise (the
 * lock screen). The caller zeroes it. Both halves are gone afterwards, used or not, as are records of closed tabs.
 */
export async function takeResumeKey(user: string | null | undefined, delayMs: number): Promise<Uint8Array | null> {
  const f = found;
  if (!f || inApp()) return null;
  try {
    if (!canResume(f, { at: Date.now(), user, delayMs }) || typeof f.iv !== "string" || typeof f.sealed !== "string") return null;
    const rec = await within(db<{ key?: CryptoKey } | undefined>((s) => s.get(f.id)));
    if (!(rec?.key instanceof CryptoKey)) return null;
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: buf(fromBase64url(f.iv)), additionalData: enc.encode(f.owner) }, rec.key, buf(fromBase64url(f.sealed))));
    if (plain.length === 32) return plain;
    plain.fill(0);
    return null;
  } catch { return null; } // a missing record, a key that doesn't open it, storage refused: the lock screen
  finally { if (typeof f.id === "string") dropRecord(f.id); }
}
function sweep() {
  const now = Date.now();
  void db((s) => {
    const r = s.openCursor();
    r.onsuccess = () => { const c = r.result; if (!c) return; const v = c.value as { until?: unknown }; if (typeof v?.until !== "number" || v.until < now) c.delete(); c.continue(); };
    return r;
  }, "readwrite").catch(() => {});
}

if (!inApp()) sweep();

// ----- this page's own pair, while the journal is open -----
let entry: Entry | null = null;
let wrapKey: CryptoKey | null = null;
let delay = 0;
let awayUntil: number | null = null;
let beat: ReturnType<typeof setInterval> | null = null;

const writeMark = () => { try { if (entry) sessionStorage.setItem(MARK, JSON.stringify(entry)); } catch { /* no grace, then */ } };
const writeRecord = () => {
  if (!entry || !wrapKey) return;
  const id = entry.id, until = Math.max(Date.now(), entry.until ?? 0) + delay + KEEP_MS;
  void db((s) => s.put({ key: wrapKey, until }, id), "readwrite").catch(() => {});
};

/** The journal opened (or the delay changed): keeps the key ready for a reload, for this account. Not with "Immediately". */
export async function keepForReload(owner: string | null | undefined, delayMs: number): Promise<void> {
  forgetResume();
  delay = delayMs;
  if (inApp() || !owner || delayMs <= 0 || !keyring.isOpen()) return;
  const opened = keyring.generation();
  let dataKey: Uint8Array | null = null;
  try {
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    const iv = randomBytes(12);
    dataKey = keyring.get();
    if (!dataKey) return;
    const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: buf(iv), additionalData: enc.encode(owner) }, key, buf(dataKey)));
    // the lock, or another account, may have come meanwhile
    if (keyring.generation() !== opened || entry) return;
    const id = toBase64url(randomBytes(16));
    await within(db((s) => s.put({ key, until: Date.now() + delayMs + KEEP_MS }, id), "readwrite"));
    if (keyring.generation() !== opened || entry) { dropRecord(id); return; }
    wrapKey = key;
    entry = { id, owner, until: awayUntil, iv: toBase64url(iv), sealed: toBase64url(sealed) };
    writeMark();
    beat = setInterval(writeRecord, 60_000);
  } catch { /* no grace: a reload asks for the password */ }
  finally { dataKey?.fill(0); }
}

/** Where the open journal stands: away since `since` (the delay counts from then), or in view (null). */
export function markAway(since: number | null, delayMs: number) {
  const until = resumeUntil(since, delayMs);
  delay = delayMs;
  if (until === awayUntil && (!entry || entry.until === until)) return;
  awayUntil = until;
  if (!entry) return;
  entry.until = until;
  writeMark();
  if (until !== null) writeRecord();
}

/** Deletes this tab's pair: the lock, signing out, another account, the delay set to "Immediately". */
export function forgetResume() {
  if (beat) clearInterval(beat);
  beat = null;
  try { sessionStorage.removeItem(MARK); } catch { /* nothing kept */ }
  if (entry) dropRecord(entry.id);
  entry = null; wrapKey = null;
}
keyring.onChange((open) => { if (!open) forgetResume(); });
