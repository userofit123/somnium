// Choices kept on this device (the look, remembered tabs and filters). Private windows may refuse storage: everything still works.
const ls = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };
// In the desktop app, a few choices are kept by the app in the account's own record instead (apps/desktop/src/main.ts
// KEPT_PREFS): browser storage belongs to the account's address, which can change (its port taken by something else),
// and the lock's wrong-try count must not start over with it. Elsewhere the address doesn't change and these stay here.
const ACCOUNT_KEPT = new Set(["somniumLockTries", "somniumLock"]);
interface KeptPrefs { get(k: string): string | null; set(k: string, v: string | null): boolean }
const kept = (k: string): KeptPrefs | undefined =>
  ACCOUNT_KEPT.has(k) ? (globalThis as { somniumNative?: { prefs?: KeptPrefs } }).somniumNative?.prefs : undefined;

export function readJson<T>(k: string, fallback: T): T {
  try {
    // the app's copy when it has one; before it has (the first start of this version), what this address kept
    const app = kept(k)?.get(k);
    const v = app ?? ls()?.getItem(k);
    return v == null ? fallback : (JSON.parse(v) ?? fallback);
  } catch { return fallback; }
}
/** null removes it: a record that is forgotten leaves no key behind (reading it gives the fallback either way). */
export function writeJson(k: string, v: unknown) {
  const text = v === null ? null : JSON.stringify(v);
  try { kept(k)?.set(k, text ?? null); } catch { /* the copy below still counts */ }
  try { if (text == null) ls()?.removeItem(k); else ls()?.setItem(k, text); } catch { /* not remembered */ }
}
export function storedKeys(): string[] {
  try { const s = ls(); return s ? Array.from({ length: s.length }, (_, i) => s.key(i) ?? "") : []; } catch { return []; }
}
export function readStr(k: string, fallback = ""): string {
  try { return ls()?.getItem(k) ?? fallback; } catch { return fallback; }
}
export function writeStr(k: string, v: string) {
  try { ls()?.setItem(k, v); } catch { /* not remembered */ }
}

// This install's own random id, sent with sign-in so the account's activity log can say when a new device signs in
// (PLAN.md §4.2). It says nothing about the device. Where storage is refused it lasts until the page is closed.
const DEVICE_ID = "somniumDeviceId";
let installId = "";
export function deviceId(): string {
  if (installId) return installId;
  installId = readStr(DEVICE_ID);
  if (!installId) {
    installId = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
    writeStr(DEVICE_ID, installId);
  }
  return installId;
}
