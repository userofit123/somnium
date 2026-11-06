// Choices kept on this device (the look, remembered tabs and filters). Private windows may refuse storage: everything still works.
const ls = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };
export function readJson<T>(k: string, fallback: T): T {
  try { const v = ls()?.getItem(k); return v == null ? fallback : (JSON.parse(v) ?? fallback); } catch { return fallback; }
}
export function writeJson(k: string, v: unknown) {
  try { ls()?.setItem(k, JSON.stringify(v)); } catch { /* not remembered */ }
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
