// The data key and its wrapping (PLAN.md §4.1). One random 256-bit data key per account seals everything
// personal; it is stored only wrapped by a key-encryption key (kek): the password's encKey, the recovery key's
// kek or this device's Keystore / safeStorage key. Re-wrapping changes the password without touching the data.
import { SealError, randomBytes } from "./bytes";
import { sealBytes, unsealBytes } from "./seal";

export const DATA_KEY_BYTES = 32;
// Bound into every wrap so a wrapped key can never be mistaken for, or swapped with, a sealed journal value.
const WRAP_AAD = "somnium-key-wrap";

/** A fresh data key: 32 random bytes. Made once per account and never shown. */
export const newDataKey = (): Uint8Array => randomBytes(DATA_KEY_BYTES);

/** AES-256-GCM the data key under the kek → "v1.<iv>.<ciphertext+tag>" (same envelope as sealed values). */
export const wrapKey = (dataKey: Uint8Array, kek: Uint8Array): Promise<string> => {
  if (dataKey.length !== DATA_KEY_BYTES) throw new SealError("A data key is 32 bytes");
  return sealBytes(dataKey, kek, WRAP_AAD);
};

/** The data key back from its envelope. A wrong kek or any changed byte throws a SealError. */
export async function unwrapKey(wrapped: string, kek: Uint8Array): Promise<Uint8Array> {
  const key = await unsealBytes(wrapped, kek, WRAP_AAD);
  if (key.length !== DATA_KEY_BYTES) throw new SealError("Not a wrapped data key");
  return key;
}
