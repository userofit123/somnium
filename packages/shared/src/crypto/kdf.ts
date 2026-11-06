// Password → keys (PLAN.md §4.1, Bitwarden's model).
//
//   Argon2id(password, salt)  ──HKDF "somnium-enc"──▶  encKey   wraps the data key; stays on the device
//                             ──HKDF "somnium-auth"─▶  authKey  sent to the server instead of the password
//
// Why the server cannot read the journal: it only ever receives authKey (and stores a scrypt hash of it).
// encKey and authKey are two independent HKDF outputs of the same Argon2id master key; HKDF-SHA256 is a one-way
// expansion, so knowing one output gives no way back to the master key or sideways to the other output. To get
// encKey the server would have to guess the password itself and run Argon2id (64 MiB, 3 passes) per guess,
// which is exactly the cost the password hash would impose on an attacker anyway. The password never leaves
// the device.
//
// hash-wasm's Argon2id runs as WebAssembly on every platform. It is loaded on first use so that screens which
// never derive a key (most of the app) do not download it.
import { utf8 } from "./bytes";

export const ARGON2 = { memoryKiB: 64 * 1024, iterations: 3, parallelism: 1, hashLength: 32 } as const;
export const SALT_BYTES = 16;
const KEY_BITS = 256;

let hashWasm: Promise<typeof import("hash-wasm")> | undefined;

/** Argon2id with the app's parameters, 32 bytes out. Loads hash-wasm the first time it is called. */
export async function argon2(secret: string | Uint8Array, salt: Uint8Array): Promise<Uint8Array> {
  hashWasm ??= import("hash-wasm");
  const { argon2id } = await hashWasm;
  return argon2id({
    password: typeof secret === "string" ? utf8(secret.normalize("NFC")) : secret,
    salt,
    iterations: ARGON2.iterations,
    parallelism: ARGON2.parallelism,
    memorySize: ARGON2.memoryKiB,
    hashLength: ARGON2.hashLength,
    outputType: "binary",
  });
}

/** HKDF-SHA256(master, salt, info) → 32 bytes. Each info string is its own independent key. */
export async function hkdf(master: Uint8Array, salt: Uint8Array, info: string): Promise<Uint8Array> {
  const key = await globalThis.crypto.subtle.importKey("raw", master, "HKDF", false, ["deriveBits"]);
  const bits = await globalThis.crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info: utf8(info) }, key, KEY_BITS);
  return new Uint8Array(bits);
}

export interface PasswordKeys { encKey: Uint8Array; authKey: Uint8Array }

/** The two keys a password gives for one account salt. Deterministic: same password and salt → same keys. */
export async function deriveKeys(password: string, salt: Uint8Array): Promise<PasswordKeys> {
  const master = await argon2(password, salt);
  const [encKey, authKey] = await Promise.all([hkdf(master, salt, "somnium-enc"), hkdf(master, salt, "somnium-auth")]);
  master.fill(0);
  return { encKey, authKey };
}

/** A fresh account salt (16 random bytes); stored next to the wrapped data key, not secret. */
export const newSalt = (): Uint8Array => globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES));
