// The sign-in keys, made on this device (PLAN.md §4.1): Argon2id on the password with the account's salt gives
// encKey (opens the journal here) and authKey (the only thing the server ever sees). The password itself never
// leaves this file's callers. The salt comes from the server; a name without an account gets a stand-in salt,
// so the question never tells whether the account exists.
import { deriveKeys, fromBase64url, toBase64url, type PasswordKeys } from "@somnium/shared";
import { api } from "../api/client";

export interface SignInKeys extends PasswordKeys { salt: string; authKeyText: string }

/** Both keys for a username and password, after fetching the salt. Slow by design (about a second). */
export async function keysFor(username: string, password: string): Promise<SignInKeys> {
  const { kdfSalt } = await api.get<{ kdfSalt: string }>("/auth/salt", { username });
  const keys = await deriveKeys(password, fromBase64url(kdfSalt));
  return { ...keys, salt: kdfSalt, authKeyText: toBase64url(keys.authKey) };
}

/** Just the authKey as the server takes it, for asking the password again (change it, turn two-factor off, delete). */
export const authKeyFor = async (username: string, password: string): Promise<string> => (await keysFor(username, password)).authKeyText;
