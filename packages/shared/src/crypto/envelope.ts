// The account's key bundle (PLAN.md §4.1): the one data key, wrapped by each thing that may open it.
// Everything here is JSON-ready text (base64url, envelopes) except the data key itself, which is raw bytes
// that live only in the app's memory and in the device's protected store.
//
//   password      Argon2id + HKDF "somnium-enc"      → wrappedByPassword   (authKey goes to the server)
//   recovery key  Argon2id + HKDF "somnium-recovery" → wrappedByRecovery   (recoveryVerifier goes to the server)
//   this device   Keystore / safeStorage key         → wrappedByDevice     (stays on the device)
//
// Changing the password or making a new recovery key re-wraps the data key; the sealed journal is untouched.
import { fromBase64url, toBase64url } from "./bytes";
import { deriveKeys, newSalt } from "./kdf";
import { newDataKey, unwrapKey, wrapKey } from "./keys";
import { deriveRecoveryKeys, newRecoveryKey } from "./recovery";

/** What the server keeps for the password: the salt and the wrapped key (public), the authKey as a scrypt hash. */
export interface PasswordBundle { salt: string; wrappedByPassword: string }
export interface AccountKeys extends PasswordBundle { authKey: string; dataKey: Uint8Array }
export interface RecoveryBundle { recoverySalt: string; wrappedByRecovery: string }
export interface RecoveryKeySet extends RecoveryBundle { recoveryKey: string; recoveryVerifier: string }

/** A new account: a fresh data key wrapped by the password. Send salt, authKey and wrappedByPassword to the server. */
export async function createAccountKeys(password: string): Promise<AccountKeys> {
  const dataKey = newDataKey();
  return { ...(await wrapWithPassword(dataKey, password)), dataKey };
}

/** Sign-in: the data key from the bundle. A wrong password throws a SealError. Pass an already-derived encKey
 *  (from deriveKeys, whose authKey the sign-in request just sent) to avoid running Argon2id a second time. */
export async function openWithPassword(bundle: PasswordBundle, password: string | Uint8Array): Promise<Uint8Array> {
  const encKey = typeof password === "string" ? (await deriveKeys(password, fromBase64url(bundle.salt))).encKey : password;
  return unwrapKey(bundle.wrappedByPassword, encKey);
}

/** A new password: a new salt, a new authKey and a re-wrap of the same data key. Nothing sealed changes. */
export async function changePassword(_bundle: PasswordBundle, dataKey: Uint8Array, newPassword: string): Promise<Omit<AccountKeys, "dataKey">> {
  return wrapWithPassword(dataKey, newPassword);
}

async function wrapWithPassword(dataKey: Uint8Array, password: string): Promise<Omit<AccountKeys, "dataKey">> {
  const salt = newSalt();
  const { encKey, authKey } = await deriveKeys(password, salt);
  return { salt: toBase64url(salt), authKey: toBase64url(authKey), wrappedByPassword: await wrapKey(dataKey, encKey) };
}

/** A recovery key for the data key. Show recoveryKey once; send the other three fields to the server. */
export async function addRecoveryKey(dataKey: Uint8Array): Promise<RecoveryKeySet> {
  const recoveryKey = newRecoveryKey(), salt = newSalt();
  const { kek, verifier } = await deriveRecoveryKeys(recoveryKey, salt);
  return { recoveryKey, recoverySalt: toBase64url(salt), wrappedByRecovery: await wrapKey(dataKey, kek), recoveryVerifier: toBase64url(verifier) };
}

/** The data key from a typed recovery key (any case, spaces or dashes). Also gives the verifier to show the server. */
export async function openWithRecoveryKey(bundle: RecoveryBundle, typedKey: string): Promise<{ dataKey: Uint8Array; recoveryVerifier: string }> {
  const { kek, verifier } = await deriveRecoveryKeys(typedKey, fromBase64url(bundle.recoverySalt));
  return { dataKey: await unwrapKey(bundle.wrappedByRecovery, kek), recoveryVerifier: toBase64url(verifier) };
}

/** Apps only: the data key wrapped by a 32-byte key held in the Android Keystore or Electron safeStorage, so the
 *  app can unlock with the device's screen lock and a signed-in device can set a new password (PLAN.md §4.4). */
export const wrapForDevice = (dataKey: Uint8Array, deviceKek: Uint8Array): Promise<string> => wrapKey(dataKey, deviceKek);
export const openWithDevice = (wrappedByDevice: string, deviceKek: Uint8Array): Promise<Uint8Array> => unwrapKey(wrappedByDevice, deviceKek);
