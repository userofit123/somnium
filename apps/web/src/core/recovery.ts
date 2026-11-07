// The recovery key on this device (PLAN.md §4.1, §4.4). The key is made, typed and used only here: the server gets its
// salt, the data key wrapped by it, and a verifier (a second HKDF output that cannot unwrap anything). Argon2id runs
// once per key typed, so a wrong key costs the person about a second and costs a guesser the same.
import { addRecoveryKey, changePassword, keyProof, deriveRecoveryKeys, fromBase64url, toBase64url, unwrapKey, type RecoveryKeySet } from "@somnium/shared";
import { api } from "../api/client";
import { keyring } from "./keyring";

/** Makes (or replaces) the recovery key from the open data key (or the one just made at sign-up, which the caller
 *  zeroes). Returns the key to show once. */
export async function makeRecoveryKey(authKey: string, given?: Uint8Array): Promise<string> {
  const dataKey = given ? new Uint8Array(given) : keyring.get();
  if (!dataKey) throw new Error("Unlock your journal first");
  let set: RecoveryKeySet;
  try { set = await addRecoveryKey(dataKey); } finally { dataKey.fill(0); }
  await api.post("/auth/recovery-key", { authKey, recoverySalt: set.recoverySalt, wrappedByRecovery: set.wrappedByRecovery, recoveryVerifier: set.recoveryVerifier });
  return set.recoveryKey;
}

export interface OpenedRecovery { username: string; verifier: string; dataKey: Uint8Array; totpRequired: boolean }

/** Checks a typed key with the server and opens the data key with it. Throws with a plain message when it is wrong. */
export async function openRecovery(username: string, typedKey: string): Promise<OpenedRecovery> {
  const name = username.trim().toLowerCase();
  const { recoverySalt } = await api.get<{ recoverySalt: string }>("/auth/recovery/salt", { username: name });
  const { kek, verifier } = await deriveRecoveryKeys(typedKey, fromBase64url(recoverySalt)); // throws on a key of the wrong shape
  try {
    const verifierText = toBase64url(verifier);
    const r = await api.post<{ wrappedByRecovery: string; totpRequired: boolean }>("/auth/recovery/open", { username: name, recoveryVerifier: verifierText });
    return { username: name, verifier: verifierText, dataKey: await unwrapKey(r.wrappedByRecovery, kek), totpRequired: r.totpRequired };
  } finally { kek.fill(0); verifier.fill(0); }
}

export interface FinishedRecovery { recoveryKey: string; token?: string; kdfSalt: string; wrappedByPassword: string }

/** The new password re-wraps the opened data key, a new recovery key is made beside it, and the old key is used up.
 *  The caller puts o.dataKey in the keyring once the new key has been shown, and zeroes it. */
export async function finishRecovery(o: OpenedRecovery, newPassword: string, code: string, device: Record<string, unknown>): Promise<FinishedRecovery> {
  const pw = await changePassword(o.dataKey, newPassword);
  const next = await addRecoveryKey(o.dataKey);
  const r = await api.post<{ token?: string }>("/auth/recovery/finish", {
    username: o.username, recoveryVerifier: o.verifier, ...(code ? { code } : {}),
    authKey: pw.authKey, kdfSalt: pw.salt, wrappedByPassword: pw.wrappedByPassword, keyProof: await keyProof(o.dataKey),
    next: { recoverySalt: next.recoverySalt, wrappedByRecovery: next.wrappedByRecovery, recoveryVerifier: next.recoveryVerifier },
    ...device,
  });
  return { recoveryKey: next.recoveryKey, token: r.token, kdfSalt: pw.salt, wrappedByPassword: pw.wrappedByPassword };
}

/** The text file the "Download" button saves: the key and what it is for, nothing else. */
export function downloadRecoveryKey(username: string, key: string) {
  const blob = new Blob([`Somnium recovery key for ${username}\nIt opens your journal and sets a new password if you forget yours. Keep it somewhere safe and private.\n\n${key}\n`], { type: "text/plain" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "somnium-recovery-key.txt" });
  a.click(); URL.revokeObjectURL(a.href);
}
