// The keys of a local account (PLAN.md §4.1, §4.4): the same envelope as a server account, kept in the account's own
// record on the device instead of on a server. There is no server to show an authKey or a recovery verifier to, so
// the unwrap itself is the proof (AES-KW / AES-GCM refuse a wrong key). The verifier is kept anyway, so a typed
// recovery key is checked before anything is re-wrapped, and so the record holds what a server would get on a move.
// Nothing here can open the journal without the password or the recovery key.
import { SealError, constantTimeEqual, fromBase64url } from "./bytes";
import { addRecoveryKey, changePassword, createAccountKeys, openWithPassword } from "./envelope";
import { deriveRecoveryKeys } from "./recovery";
import { unwrapKey } from "./keys";

/** What a local account keeps. sealedAt: when its database's sealed columns were last made ciphertext (accounts made
 *  before passwords existed held plaintext); null until then. */
export interface LocalKeys {
  salt: string; wrappedByPassword: string;
  recoverySalt: string | null; wrappedByRecovery: string | null; recoveryVerifier: string | null;
  recoveryMadeAt: string | null; sealedAt: string | null;
}

const text = (v: unknown, max = 400): v is string => typeof v === "string" && v.length > 0 && v.length <= max;
const textOrNull = (v: unknown) => (v == null ? null : text(v) ? v : undefined);

/** The record as stored, checked; null when it is missing or not in the expected shape. Only a missing one gets a
 *  first password: one that is there but damaged keeps the journal's key, so only its recovery key may replace it. */
export function localKeysFrom(v: unknown): LocalKeys | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (!text(o.salt) || !text(o.wrappedByPassword)) return null;
  const rest = ["recoverySalt", "wrappedByRecovery", "recoveryVerifier", "recoveryMadeAt", "sealedAt"].map((k) => textOrNull(o[k]));
  if (rest.some((x) => x === undefined)) return null;
  const [recoverySalt, wrappedByRecovery, recoveryVerifier, recoveryMadeAt, sealedAt] = rest as (string | null)[];
  // a recovery key is all three or none
  if ([recoverySalt, wrappedByRecovery, recoveryVerifier].filter((x) => x).length % 3) return null;
  return { salt: o.salt, wrappedByPassword: o.wrappedByPassword, recoverySalt: recoverySalt!, wrappedByRecovery: wrappedByRecovery!, recoveryVerifier: recoveryVerifier!, recoveryMadeAt: recoveryMadeAt!, sealedAt: sealedAt! };
}

/**
 * From a record that is there but not in the expected shape: its recovery key part alone, when that part is whole, so
 * the recovery key can still open the journal and set a new password (recoverLocal writes the password part anew).
 * Null otherwise. Such a record must never be replaced by a new password: that would lock the journal away for good.
 */
export function localRecoveryFrom(v: unknown): LocalKeys | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (!text(o.recoverySalt) || !text(o.wrappedByRecovery) || !text(o.recoveryVerifier)) return null;
  return { salt: "", wrappedByPassword: "", recoverySalt: o.recoverySalt, wrappedByRecovery: o.wrappedByRecovery, recoveryVerifier: o.recoveryVerifier, recoveryMadeAt: null, sealedAt: textOrNull(o.sealedAt) ?? null };
}

/** A new local account's keys. The caller puts dataKey in its keyring and zeroes it. */
export async function createLocalKeys(password: string): Promise<{ keys: LocalKeys; dataKey: Uint8Array }> {
  const made = await createAccountKeys(password);
  return {
    keys: { salt: made.salt, wrappedByPassword: made.wrappedByPassword, recoverySalt: null, wrappedByRecovery: null, recoveryVerifier: null, recoveryMadeAt: null, sealedAt: null },
    dataKey: made.dataKey,
  };
}

/** The data key from the password. A wrong password throws a SealError. */
export const openLocalWithPassword = (keys: LocalKeys, password: string): Promise<Uint8Array> =>
  openWithPassword({ salt: keys.salt, wrappedByPassword: keys.wrappedByPassword }, password);

/** A new password for the open data key: the data itself is not re-encrypted. */
export async function rewrapLocalPassword(keys: LocalKeys, dataKey: Uint8Array, password: string): Promise<LocalKeys> {
  const pw = await changePassword(dataKey, password);
  return { ...keys, salt: pw.salt, wrappedByPassword: pw.wrappedByPassword };
}

/** A (new) recovery key for the open data key; any older one stops working. Show recoveryKey once. */
export async function addLocalRecoveryKey(keys: LocalKeys, dataKey: Uint8Array, now = new Date()): Promise<{ keys: LocalKeys; recoveryKey: string }> {
  const set = await addRecoveryKey(dataKey);
  return { keys: { ...keys, recoverySalt: set.recoverySalt, wrappedByRecovery: set.wrappedByRecovery, recoveryVerifier: set.recoveryVerifier, recoveryMadeAt: now.toISOString() }, recoveryKey: set.recoveryKey };
}

/**
 * Forgot the password: the recovery key opens the data key, the new password re-wraps it, and a new recovery key
 * replaces the one used (as on a server, PLAN.md §4.4). A wrong key throws a SealError and changes nothing.
 * The caller puts dataKey in its keyring, zeroes it, and stores keys before showing recoveryKey.
 */
export async function recoverLocal(keys: LocalKeys, typedKey: string, newPassword: string, now = new Date()): Promise<{ keys: LocalKeys; dataKey: Uint8Array; recoveryKey: string }> {
  if (!keys.recoverySalt || !keys.wrappedByRecovery || !keys.recoveryVerifier) throw new SealError("No recovery key was made for this account");
  const { kek, verifier } = await deriveRecoveryKeys(typedKey, fromBase64url(keys.recoverySalt));
  let dataKey: Uint8Array;
  try {
    if (!constantTimeEqual(verifier, fromBase64url(keys.recoveryVerifier))) throw new SealError("That recovery key is not right");
    dataKey = await unwrapKey(keys.wrappedByRecovery, kek);
  } finally { kek.fill(0); verifier.fill(0); }
  try {
    const withPassword = await rewrapLocalPassword(keys, dataKey, newPassword);
    const next = await addLocalRecoveryKey(withPassword, dataKey, now);
    return { keys: next.keys, dataKey, recoveryKey: next.recoveryKey };
  } catch (e) { dataKey.fill(0); throw e; }
}
