// The password and recovery key of a local account (LDJ-53, PLAN.md §4.1, §4.3, §4.4). The same envelope as a server
// account, kept in the account's own record on this device (the desktop app's accounts file, the Android app's account
// list) instead of on a server: the salt, the data key wrapped by the password, and the recovery key's salt, wrapped
// key and verifier. The data key itself is only ever in the keyring, and goes when the app locks.
//
// The journal of a local account is sealed at rest: every sealed column is ciphertext in its database, sealed by the
// transport on the way in and opened on the way out (api/client.ts sealingTransport), as for a server. An account made
// before this had plaintext: the first time its password is set, what it holds is sealed in place (sealJournalInPlace).
import { addLocalRecoveryKey, createLocalKeys, localKeysFrom, localRecoveryFrom, openLocalWithPassword, recoverLocal, rewrapLocalPassword, SealError, type LocalKeys } from "@somnium/shared";
import { api } from "../api/client";
import { keyring } from "./keyring";

interface NativeAccounts { keys?: () => Promise<unknown>; setKeys?: (k: LocalKeys) => Promise<void>; compact?: () => Promise<void> }
const native = (): NativeAccounts | undefined => (globalThis as { somniumNative?: { accounts?: NativeAccounts } }).somniumNative?.accounts;

// the record as the app keeps it: null only when there is none. Throws when the app can't be asked.
const record = async (): Promise<unknown> => (await native()?.keys?.()) ?? null;
/** This local account's keys, or null when it has none in the expected shape (see localKeyState). */
export async function localKeys(): Promise<LocalKeys | null> { return localKeysFrom(await record()); }
/**
 * "none": no record, an account made before passwords (the lock screen sets one). "ready": the password opens it.
 * "damaged": a record is there but isn't in the expected shape: it may still hold the only way to the journal's key,
 * so no new password replaces it, only the recovery key (recoverLocalAccount). Throws when the record can't be read.
 */
export async function localKeyState(): Promise<"none" | "ready" | "damaged"> {
  const r = await record();
  return r === null ? "none" : localKeysFrom(r) ? "ready" : "damaged";
}
/** The keys the recovery key can work with: the whole record, or a damaged record's recovery part. */
async function recoverableKeys(): Promise<LocalKeys | null> { const r = await record(); return localKeysFrom(r) ?? localRecoveryFrom(r); }
export const canRecoverLocal = async () => hasLocalRecoveryKey(await recoverableKeys());
async function store(k: LocalKeys) {
  const n = native();
  if (!n?.setKeys) throw new Error("This app can't keep a password for this account. Update it.");
  await n.setKeys(k);
}

/** With the data key held for one step, zeroed after it. */
function withKey<T>(step: (key: Uint8Array) => Promise<T>): Promise<T> {
  const key = keyring.get();
  if (!key) throw new Error("Unlock your journal first");
  return step(key).finally(() => key.fill(0));
}

/** The first password: makes the data key and opens the journal with it. The caller has checked the password's rules. */
export async function setUpLocalPassword(password: string): Promise<void> {
  // any record at all, readable or not, holds a wrapped key: replacing it would lose the journal for good
  if ((await record()) !== null) throw new Error("This account already has a password. Use it, or your recovery key.");
  const { keys, dataKey } = await createLocalKeys(password);
  try { await store(keys); keyring.set(dataKey); } finally { dataKey.fill(0); }
}

/** Opens the journal with the password. False for a wrong one. */
export async function unlockLocal(password: string): Promise<boolean> {
  const keys = await localKeys();
  if (!keys) throw new Error("This account has no password yet");
  let key: Uint8Array;
  try { key = await openLocalWithPassword(keys, password); } catch (e) { if (e instanceof SealError) return false; throw e; }
  try { keyring.set(key); } finally { key.fill(0); }
  return true;
}

/** Makes (or replaces) the recovery key from the open journal. Returns the key to show once. */
export async function makeLocalRecoveryKey(): Promise<string> {
  const keys = await localKeys();
  if (!keys) throw new Error("This account has no password yet");
  return withKey(async (key) => { const made = await addLocalRecoveryKey(keys, key); await store(made.keys); return made.recoveryKey; });
}

/** A new password for the open journal; the current one is checked first, as on a server account. */
export async function changeLocalPassword(current: string, next: string): Promise<boolean> {
  const keys = await localKeys();
  if (!keys) throw new Error("This account has no password yet");
  try { (await openLocalWithPassword(keys, current)).fill(0); } catch (e) { if (e instanceof SealError) return false; throw e; }
  await withKey(async (key) => store(await rewrapLocalPassword(keys, key, next)));
  return true;
}

/** A new password without the old one (LDJ-10): the phone's own verification released this key (core/deviceKey.ts,
 *  which has checked it is the open journal's key). */
export async function setLocalPasswordFromDevice(dataKey: Uint8Array, next: string): Promise<void> {
  const keys = await localKeys();
  if (!keys) throw new Error("This account has no password yet");
  await store(await rewrapLocalPassword(keys, dataKey, next));
}

/** Forgot the password: the recovery key opens the journal, sets the new password and is replaced by a new one, which is returned to show once. */
export async function recoverLocalAccount(typedKey: string, newPassword: string): Promise<string> {
  const keys = await recoverableKeys();
  if (!keys) throw new Error("No recovery key was made for this account");
  const done = await recoverLocal(keys, typedKey, newPassword);
  try { await store(done.keys); keyring.set(done.dataKey); } finally { done.dataKey.fill(0); }
  return done.recoveryKey;
}

/** Whether this is the password, without touching the open journal (a guard before a sensitive change). */
export async function checkLocalPassword(password: string): Promise<boolean> {
  const keys = await localKeys();
  if (!keys) return false;
  try { (await openLocalWithPassword(keys, password)).fill(0); return true; } catch (e) { if (e instanceof SealError) return false; throw e; }
}

export const hasLocalRecoveryKey = (k: LocalKeys | null) => !!k?.wrappedByRecovery;

/**
 * An account made before passwords holds plaintext: everything in it goes out through the transport (which opens what
 * is sealed and passes older plaintext as it is) and comes back in sealed, in one transaction, so nothing is lost if it
 * stops halfway. Then the old plaintext versions are cleared from the database files. Runs again on the next unlock
 * until it has finished once. Photos a desktop account stored as files before this stay as they were (docs/security.md).
 */
export async function sealJournalInPlace(): Promise<void> {
  const keys = await localKeys();
  if (!keys || keys.sealedAt) return;
  const data = await api.get<{ unopened?: number }>("/export");
  // a row that didn't open is sealed with another key: replacing would lose it, so this waits rather than guess
  if (data?.unopened) throw new Error("Part of this journal couldn't be opened, so it was left as it is");
  await api.post("/import", { data, mode: "replace" });
  await native()?.compact?.();
  await store({ ...keys, sealedAt: new Date().toISOString() });
}
