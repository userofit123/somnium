// The account's data key while the app is open (PLAN.md §4.1): the 32 bytes that seal the journal on its way to
// the server and open what comes back (packages/engine/src/sync/sealing.ts). Held in memory only. Sign-in puts it
// here after unwrapping the envelope with the password; the apps' device wrapping (Keystore, safeStorage) is
// LDJ-9/10 and also ends up here. Signing out and the app lock clear it. It is never written to storage, logs,
// errors or exports by this module, and nothing here persists it.
//
// Nobody outside this module holds the live key: get() hands out a copy, which its caller zeroes when done, so
// clearing the keyring can't be undone by a reference left behind, nor can a caller's zeroing break the keyring.
type Listener = (open: boolean) => void;

let current: Uint8Array | null = null;
const listeners = new Set<Listener>();
const tell = () => { for (const fn of listeners) { try { fn(current !== null); } catch { /* a listener's problem is its own */ } } };

export const keyring = {
  /** A copy of the open data key, or null while the journal is locked on this device. Zero it when done. */
  get(): Uint8Array | null { return current ? new Uint8Array(current) : null; },
  /** Whether the key is open, without making a copy of it. */
  isOpen(): boolean { return current !== null; },
  set(k: Uint8Array): void {
    if (k.length !== 32) throw new Error("A data key is 32 bytes");
    const next = new Uint8Array(k); // our own copy: the caller may zero theirs
    current?.fill(0);
    current = next;
    tell();
  },
  clear(): void {
    if (current) current.fill(0);
    current = null;
    tell();
  },
  /** Called with whether the key is open whenever it is set or cleared; returns an unsubscribe function. */
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
