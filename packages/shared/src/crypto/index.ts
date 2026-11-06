// The sealed journal's client-side cryptography (PLAN.md §4.1). Pure WebCrypto plus hash-wasm's Argon2id, loaded
// on first use. Runs unchanged in the browser, Electron, the Android WebView and Node 22.
export { utf8, fromUtf8, randomBytes, toBase64url, fromBase64url, concatBytes, constantTimeEqual, SealError } from "./bytes";
export { ARGON2, SALT_BYTES, argon2, hkdf, deriveKeys, newSalt, type PasswordKeys } from "./kdf";
export { DATA_KEY_BYTES, newDataKey, wrapKey, unwrapKey } from "./keys";
export { ENVELOPE_VERSION, isSealed, sealBytes, unsealBytes, sealText, unsealText } from "./seal";
export {
  RECOVERY_KEY_CHARS, RECOVERY_KEY_LENGTH, plainRecoveryKey, formatRecoveryKey, newRecoveryKey,
  deriveRecoveryKeys, recoveryKek, recoveryVerifier, type RecoveryKeys,
} from "./recovery";
export {
  createAccountKeys, openWithPassword, changePassword, addRecoveryKey, openWithRecoveryKey, wrapForDevice, openWithDevice,
  type PasswordBundle, type AccountKeys, type RecoveryBundle, type RecoveryKeySet,
} from "./envelope";
