// Choices kept on this device (the look, remembered tabs and filters). Private windows may refuse storage: everything still works.
const ls = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };
export function readJson<T>(k: string, fallback: T): T {
  try { const v = ls()?.getItem(k); return v == null ? fallback : (JSON.parse(v) ?? fallback); } catch { return fallback; }
}
export function writeJson(k: string, v: unknown) {
  try { ls()?.setItem(k, JSON.stringify(v)); } catch { /* not remembered */ }
}
export function readStr(k: string, fallback = ""): string {
  try { return ls()?.getItem(k) ?? fallback; } catch { return fallback; }
}
export function writeStr(k: string, v: string) {
  try { ls()?.setItem(k, v); } catch { /* not remembered */ }
}
