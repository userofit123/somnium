// Sealing one value with the data key (PLAN.md §4.1): AES-256-GCM, a fresh 12-byte nonce per value, and the
// result as a versioned text envelope that fits a text column, a JSON field or a URL:
//
//   v1.<base64url iv>.<base64url ciphertext+tag>
//
// The optional aad ("additional authenticated data", e.g. "dreams.text.<row id>") is bound into the tag without
// being stored: a ciphertext opened under a different aad fails, so a sealed value cannot be moved from one
// field or row to another by someone who holds the database but not the key.
import { SealError, fromBase64url, fromUtf8, toBase64url, utf8 } from "./bytes";

export const ENVELOPE_VERSION = "v1";
const IV_BYTES = 12;
const TAG_BITS = 128;
// iv: 12 bytes → 16 chars; ciphertext+tag: at least the 16-byte tag → at least 22 chars
const ENVELOPE = /^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22,}$/;

/** True for strings in the envelope format (no key needed): lets callers tell sealed values from plain ones. */
export const isSealed = (value: unknown): value is string => typeof value === "string" && ENVELOPE.test(value);

async function aesKey(key: Uint8Array): Promise<CryptoKey> {
  if (key.length !== 32) throw new SealError("A sealing key is 32 bytes");
  return globalThis.crypto.subtle.importKey("raw", key, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function sealBytes(plain: Uint8Array, key: Uint8Array, aad?: string): Promise<string> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const params: AesGcmParams = { name: "AES-GCM", iv, tagLength: TAG_BITS, ...(aad !== undefined ? { additionalData: utf8(aad) } : {}) };
  const ct = new Uint8Array(await globalThis.crypto.subtle.encrypt(params, await aesKey(key), plain));
  return `${ENVELOPE_VERSION}.${toBase64url(iv)}.${toBase64url(ct)}`;
}

export async function unsealBytes(sealed: string, key: Uint8Array, aad?: string): Promise<Uint8Array> {
  if (!isSealed(sealed)) throw new SealError("Not a sealed value");
  const [, ivText, ctText] = sealed.split(".") as [string, string, string];
  try {
    // decoding is inside the try: an envelope that matches the pattern but is not valid base64url (length 1 mod 4)
    // must also surface as a SealError, never as a DOMException
    const iv = fromBase64url(ivText), ct = fromBase64url(ctText);
    const params: AesGcmParams = { name: "AES-GCM", iv, tagLength: TAG_BITS, ...(aad !== undefined ? { additionalData: utf8(aad) } : {}) };
    return new Uint8Array(await globalThis.crypto.subtle.decrypt(params, await aesKey(key), ct));
  } catch {
    // WebCrypto gives one opaque error for a wrong key, a changed byte and a mismatched aad; so do we
    throw new SealError();
  }
}

export const sealText = (text: string, key: Uint8Array, aad?: string): Promise<string> => sealBytes(utf8(text), key, aad);

export async function unsealText(sealed: string, key: Uint8Array, aad?: string): Promise<string> {
  const bytes = await unsealBytes(sealed, key, aad);
  try { return fromUtf8(bytes); } catch { throw new SealError("Sealed value is not text"); }
}

// Sealed database columns bind the value to its place: "<table>.<column>.<row id>". These helpers build that aad
// so callers cannot forget it (or spell it differently on the way in and out).
const columnAad = (table: string, column: string, rowId: string): string => `${table}.${column}.${rowId}`;

export const sealColumn = (plain: string | Uint8Array, key: Uint8Array, table: string, column: string, rowId: string): Promise<string> =>
  typeof plain === "string" ? sealText(plain, key, columnAad(table, column, rowId)) : sealBytes(plain, key, columnAad(table, column, rowId));

export const unsealColumn = (sealed: string, key: Uint8Array, table: string, column: string, rowId: string): Promise<string> =>
  unsealText(sealed, key, columnAad(table, column, rowId));

export const unsealColumnBytes = (sealed: string, key: Uint8Array, table: string, column: string, rowId: string): Promise<Uint8Array> =>
  unsealBytes(sealed, key, columnAad(table, column, rowId));
