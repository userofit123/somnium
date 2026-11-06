// The account's data key while the app is open (PLAN.md §4.1): the 32 bytes that seal the journal on its way to
// the server and open what comes back (packages/engine/src/sync/sealing.ts). Held in memory only. Sign-in puts it
// here after unwrapping the envelope with the password; the apps' device wrapping (Keystore, safeStorage) is
// LDJ-9/10 and also ends up here. Signing out and the app lock clear it. It is never written to storage, logs,
// errors or exports by this module, and nothing here persists it.
type Listener = (key: Uint8Array | null) => void;

let current: Uint8Array | null = null;
const listeners = new Set<Listener>();
const tell = () => { for (const fn of listeners) { try { fn(current); } catch { /* a listener's problem is its own */ } } };

export const keyring = {
  /** The open data key, or null while the journal is locked on this device. */
  get(): Uint8Array | null { return current; },
  set(k: Uint8Array): void {
    if (k.length !== 32) throw new Error("A data key is 32 bytes");
    current = new Uint8Array(k); // our own copy: the caller may zero theirs
    tell();
  },
  clear(): void {
    if (current) current.fill(0);
    current = null;
    tell();
  },
  /** Called with the key whenever it is set or cleared; returns an unsubscribe function. */
  onChange(cb: Listener): () => void { listeners.add(cb); return () => listeners.delete(cb); },
};

/**
 * Development and tests only: opens a fixed, throwaway key so sync can be exercised before sign-in hands over the
 * real one. Nothing sealed with it is worth anything, and the production build refuses it.
 */
export function devOpenKeyring(seed = 7): Uint8Array {
  if (!import.meta.env.DEV) throw new Error("The development key is not available in a production build");
  const k = new Uint8Array(32);
  for (let i = 0; i < k.length; i++) k[i] = (seed * 31 + i * 17) & 0xff;
  keyring.set(k);
  return k;
}
