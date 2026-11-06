// Byte helpers for the sealed journal (PLAN.md §4.1). Pure WebCrypto / TextEncoder: the same code runs in the
// browser, Electron, the Android WebView and Node 22, so every platform seals and opens the same envelopes.

const utf8Enc = new TextEncoder();
const utf8Dec = new TextDecoder("utf-8", { fatal: true });

export const utf8 = (s: string): Uint8Array => utf8Enc.encode(s);
export const fromUtf8 = (b: Uint8Array): string => utf8Dec.decode(b);

/** n cryptographically random bytes (keys, salts, nonces). */
export const randomBytes = (n: number): Uint8Array => globalThis.crypto.getRandomValues(new Uint8Array(n));

/** base64url without padding (RFC 4648 §5): safe inside envelope strings, JSON, URLs and SQL text columns. */
export function toBase64url(b: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function fromBase64url(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error("Not base64url");
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/** Compares two byte strings in time that depends only on their length, so a verifier check leaks nothing. */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

/** Thrown when a sealed value cannot be opened: wrong key, a changed byte, a moved field or not an envelope at all. */
export class SealError extends Error {
  constructor(message = "Cannot open the sealed value") { super(message); this.name = "SealError"; }
}
