// The recovery key (PLAN.md §4.1 and §4.4): 20 characters from 31 unambiguous ones (no 0/O, 1/I/L), about
// 99 bits, shown once as 5 groups of 4 with dashes - Money Manager's format (server/src/passwordRecovery.js).
// It wraps the same data key as the password, so the journal opens again when the password is lost.
//
// From one Argon2id run two independent HKDF keys are taken:
//   "somnium-recovery"       the kek that wraps the data key; only ever on the device
//   "somnium-recovery-auth"  the verifier the server stores to check a typed key before handing out the
//                            wrapped data key; it cannot unwrap anything (one-way, like authKey vs encKey)
import { randomBytes } from "./bytes";
import { argon2, hkdf } from "./kdf";

export const RECOVERY_KEY_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const RECOVERY_KEY_LENGTH = 20;

/** What was typed, without spaces, dashes or case: "abcd-efgh ..." and "ABCDEFGH..." are the same key. */
export const plainRecoveryKey = (typed: string): string => String(typed ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** "ABCD-EFGH-JKMN-PQRS-TUVW": the form shown to the person. */
export const formatRecoveryKey = (plain: string): string => plainRecoveryKey(plain).match(/.{1,4}/g)?.join("-") ?? "";

/** A new key, formatted. Rejection sampling keeps every character equally likely (256 is not a multiple of 31). */
export function newRecoveryKey(): string {
  let s = "";
  while (s.length < RECOVERY_KEY_LENGTH) {
    for (const b of randomBytes(RECOVERY_KEY_LENGTH)) {
      // 248 = 8 × 31: the largest multiple of 31 below 256; higher bytes would favour the first few characters
      if (b < 248 && s.length < RECOVERY_KEY_LENGTH) s += RECOVERY_KEY_CHARS[b % RECOVERY_KEY_CHARS.length];
    }
  }
  return formatRecoveryKey(s);
}

export interface RecoveryKeys { kek: Uint8Array; verifier: Uint8Array }

/** Both recovery-derived keys from one Argon2id run (the slow part), for making and for using a key. */
export async function deriveRecoveryKeys(recoveryKey: string, salt: Uint8Array): Promise<RecoveryKeys> {
  const master = await argon2(plainRecoveryKey(recoveryKey), salt);
  const [kek, verifier] = await Promise.all([hkdf(master, salt, "somnium-recovery"), hkdf(master, salt, "somnium-recovery-auth")]);
  master.fill(0);
  return { kek, verifier };
}

/** The key-encryption key a recovery key gives: wraps and unwraps the data key. Never leaves the device. */
export const recoveryKek = async (recoveryKey: string, salt: Uint8Array): Promise<Uint8Array> => (await deriveRecoveryKeys(recoveryKey, salt)).kek;

/** What the server stores to check a typed recovery key. Knowing it does not help unwrap the data key. */
export const recoveryVerifier = async (recoveryKey: string, salt: Uint8Array): Promise<Uint8Array> => (await deriveRecoveryKeys(recoveryKey, salt)).verifier;
