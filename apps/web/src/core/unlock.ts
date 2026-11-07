// What opens the journal on the lock screen (PLAN.md §4.3). Two things, both of which produce the data key:
//  - the password, on the bundle the server keeps (salt + wrapped key). A copy is kept on this device so unlocking
//    works offline; it is exactly what the server holds, and is useless without the password.
//  - the device's own verification: a WebAuthn platform authenticator whose PRF extension gives 32 secret bytes that
//    only come out after the fingerprint, face or screen lock. They wrap the data key. Without PRF, WebAuthn proves a
//    presence but can't release anything, and the key is never kept unprotected to make up for it: then it is the password.
//
// The desktop and Android apps don't use WebAuthn: the desktop app runs from http://127.0.0.1, which WebAuthn refuses.
// The Android app has its own path in its place (LDJ-9): somniumNative.deviceLock, the data key wrapped by a Keystore
// key that BiometricPrompt opens (fingerprint, face or screen lock), the blob kept in the account's record. Its wrong
// tries go through the same counter: a blob that doesn't open is a SealError; a cancelled prompt never counts.
// A server account then tells its server that this sign-in holds the key (LDJ-10, with the key proof), which is what
// lets it set a new password without the old one (core/deviceKey.ts). The desktop app has no device verification:
// safeStorage can't make it ask for the person (apps/desktop/src/main.ts, docs/security.md).
import { SealError, devicePath, fromBase64url, hkdf, keyProof, openWithDevice, openWithPassword, ownRecord, randomBytes, toBase64url, unlockRecordName, unlockRecordsToForget, wrapForDevice } from "@somnium/shared";
import { api, server } from "../api/client";
import { keyring } from "./keyring";
import { readJson, storedKeys, writeJson } from "./prefs";
import { isLocalAccount, session } from "./session";
import { savedUserIds } from "../native/accounts";

export interface UnlockBundle { salt: string; wrappedByPassword: string | null }
interface DeviceCredential { credentialId: string; prfSalt: string; wrapped: string }
/** This device's verification for this account. noPrf: tried, and this authenticator can't release a key. */
interface DeviceRecord { owner?: string; off?: boolean; asked?: boolean; noPrf?: boolean; cred?: DeviceCredential; held?: boolean; registered?: boolean }
/** The Android app's Keystore lock (native/android.ts). dataKey and the answers are base64url. */
export interface NativeDeviceLock { available(): Promise<boolean>; has(): boolean; wrap(dataKey: string): Promise<void>; unwrap(): Promise<string>; forget(): Promise<void>; forgetFor(userId: string, place: string): void }
export const nativeLock = (): NativeDeviceLock | undefined => (globalThis as { somniumNative?: { deviceLock?: NativeDeviceLock } }).somniumNative?.deviceLock;

const place = () => server.value.base || location.origin;
const BUNDLE = "somniumUnlock", DEVICE = "somniumDeviceUnlock";
// Both records are per person: the next person on this device must never be offered what opens someone else's journal.
// That key in their session would seal their rows where they could never open them.
const me = () => session.user?.id ?? null;
const readOwn = <T extends { owner?: string }>(kind: string): T | null => {
  const id = me();
  return id ? ownRecord(readJson<T | null>(unlockRecordName(kind, place(), id), null), id) : null;
};
const writeOwn = (kind: string, r: object, id = me()) => { if (id) writeJson(unlockRecordName(kind, place(), id), { ...r, owner: id }); };
const readDevice = (): DeviceRecord => readOwn<DeviceRecord>(DEVICE) ?? {};
const writeDevice = (r: DeviceRecord) => writeOwn(DEVICE, r);

// ----- the password -----
export const rememberBundle = (b: UnlockBundle) => writeOwn(BUNDLE, b);
export const cachedBundle = () => readOwn<UnlockBundle & { owner?: string }>(BUNDLE);

/** The server's bundle when it answers (the password may have changed elsewhere), this device's copy when it doesn't. */
export async function freshBundle(): Promise<UnlockBundle | null> {
  // who asked, taken before the wait: another sign-in during it must not get this person's bundle stored as its own
  const id = me();
  try {
    const r = await api.get<{ kdfSalt: string; wrappedByPassword: string | null }>("/auth/bundle", undefined, { wait: 4000 });
    const b = { salt: r.kdfSalt, wrappedByPassword: r.wrappedByPassword };
    if (id && me() === id) writeOwn(BUNDLE, b, id);
    return b;
  } catch { return cachedBundle(); }
}

/** Opens the journal with the password: a successful unwrap is the proof. Returns false for a wrong password. */
export async function unlockWithPassword(bundle: UnlockBundle & { wrappedByPassword: string }, password: string): Promise<boolean> {
  let key: Uint8Array;
  try { key = await openWithPassword({ salt: bundle.salt, wrappedByPassword: bundle.wrappedByPassword }, password); }
  catch (e) { if (e instanceof SealError) return false; throw e; }
  try { keyring.set(key); } finally { key.fill(0); }
  return true;
}

// ----- the device's own verification -----
const buffer = (b: Uint8Array) => b.slice().buffer as ArrayBuffer;
const inApp = () => !!(globalThis as { somniumNative?: unknown }).somniumNative;
// WebAuthn takes a domain name as its site, never an IP address
const hasDomainName = () => !/^(\d+\.){3}\d+$|^\[/.test(location.hostname);
// the PRF output is already secret; this only ties it to this one use
const kekFrom = (prf: ArrayBuffer, prfSalt: Uint8Array) => hkdf(new Uint8Array(prf), prfSalt, "somnium-device-unlock");
const wipePrf = (prf: ArrayBuffer | null | undefined) => { if (prf) new Uint8Array(prf).fill(0); };

/** Whether this browser has a platform authenticator (Windows Hello, Touch ID, Android screen lock). */
export async function deviceVerifierExists(): Promise<boolean> {
  const n = nativeLock();
  if (n) return n.available().catch(() => false);
  if (inApp() || !hasDomainName()) return false;
  try { return (await globalThis.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable?.()) === true; } catch { return false; }
}
// on Android the key is on when this account's record still holds the blob (an ended Keystore key drops it)
const pathOf = (r: DeviceRecord) => devicePath({ native: !!nativeLock(), held: r.held, hasBlob: !!nativeLock()?.has(), cred: !!r.cred, off: r.off });
const held = (r: DeviceRecord) => pathOf(r) === "android";
export const deviceStatus = () => { const r = readDevice(); return { on: pathOf(r) !== "password", off: !!r.off, noPrf: !!r.noPrf, asked: !!r.asked }; };
export const declineDevice = () => writeDevice({ ...readDevice(), asked: true });
export const turnDeviceOff = () => {
  const had = readDevice().held;
  writeDevice({ off: true, asked: true });
  if (!had) return;
  void nativeLock()?.forget();
  void isLocalAccount().then((local) => local ? undefined : api.del("/auth/device-key")).catch(() => {});
};
/** Should the lock screen offer to set it up after this unlock? Only once, and never when turned off. */
export async function shouldOfferDevice(): Promise<boolean> {
  const r = readDevice();
  return !r.cred && !held(r) && !r.off && !r.asked && !r.noPrf && (await deviceVerifierExists());
}

async function askPrf(credentialId: Uint8Array, prfSalt: Uint8Array): Promise<ArrayBuffer | null> {
  const got = await navigator.credentials.get({ publicKey: {
    challenge: buffer(randomBytes(32)), rpId: location.hostname, userVerification: "required", timeout: 60_000,
    allowCredentials: [{ type: "public-key", id: buffer(credentialId) }],
    extensions: { prf: { eval: { first: buffer(prfSalt) } } } as AuthenticationExtensionsClientInputs,
  } }) as PublicKeyCredential | null;
  const results = (got?.getClientExtensionResults() as { prf?: { results?: { first?: ArrayBuffer } } } | undefined)?.prf?.results;
  return results?.first ?? null;
}

/** Sets it up with the open key. "noPrf": this device can't release a key, so nothing was stored. Throws when cancelled. */
export async function setUpDevice(username: string): Promise<"on" | "noPrf"> {
  if (!keyring.isOpen()) throw new Error("Unlock first");
  const n = nativeLock();
  if (n) return setUpNative(n);
  const owner = me(), opened = keyring.generation();
  const noPrf = () => { writeDevice({ asked: true, noPrf: true }); return "noPrf" as const; };
  let output: ArrayBuffer | null | undefined, kek: Uint8Array | undefined, dataKey: Uint8Array | null = null;
  try {
    // browsers that can say so in advance spare the person a verification that leads nowhere
    const caps = await (PublicKeyCredential as unknown as { getClientCapabilities?: () => Promise<Record<string, boolean>> }).getClientCapabilities?.().catch(() => null);
    if (caps && caps["extension:prf"] === false) return noPrf();
    const prfSalt = randomBytes(32);
    const made = await navigator.credentials.create({ publicKey: {
      challenge: buffer(randomBytes(32)),
      rp: { id: location.hostname, name: "Somnium" },
      // a random handle: nothing here needs to be tied to the account, and the server is never involved
      user: { id: buffer(randomBytes(16)), name: username, displayName: username },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: "platform", residentKey: "discouraged", userVerification: "required" },
      attestation: "none", timeout: 60_000,
      extensions: { prf: { eval: { first: buffer(prfSalt) } } } as AuthenticationExtensionsClientInputs,
    } }) as PublicKeyCredential | null;
    if (!made) throw new Error("Not set up");
    const prf = (made.getClientExtensionResults() as { prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } } }).prf;
    const credentialId = new Uint8Array(made.rawId);
    // some authenticators give the output while being made; others only say they can, and need asking once more
    output = prf?.results?.first ?? (prf?.enabled ? await askPrf(credentialId, prfSalt) : null);
    if (!output) return noPrf();
    kek = await kekFrom(output, prfSalt);
    // taken only now: the dialog above can stay open for a minute. The lock or another sign-in may have come meanwhile.
    dataKey = keyring.generation() === opened && me() === owner ? keyring.get() : null;
    if (!dataKey) throw new Error("Unlock first");
    const wrapped = await wrapForDevice(dataKey, kek);
    if (keyring.generation() !== opened || me() !== owner) throw new Error("Unlock first");
    writeDevice({ asked: true, cred: { credentialId: toBase64url(credentialId), prfSalt: toBase64url(prfSalt), wrapped } });
    return "on";
  } finally { dataKey?.fill(0); kek?.fill(0); wipePrf(output); }
}

/** Android: the Keystore wraps the open key behind the prompt; a server account then registers that this sign-in holds it. */
async function setUpNative(n: NativeDeviceLock): Promise<"on"> {
  const owner = me(), opened = keyring.generation();
  const dataKey = keyring.get();
  if (!dataKey) throw new Error("Unlock first");
  let proof: string;
  try { await n.wrap(toBase64url(dataKey)); proof = await keyProof(dataKey); } finally { dataKey.fill(0); }
  // the prompt can stay open a while: the lock or another sign-in may have come meanwhile
  if (keyring.generation() !== opened || me() !== owner) { await n.forget(); throw new Error("Unlock first"); }
  writeDevice({ asked: true, held: true });
  void registerHeldKey(proof);
  return "on";
}
/** Tells the server this sign-in holds the key (the devices list, and setting a new password from here). A server that
 *  has no proof for this account yet (signed in before device keys) answers 409; it is tried again on the next unlock. */
async function registerHeldKey(proof: string) {
  const owner = me();
  try {
    if (await isLocalAccount()) return;
    await api.post("/auth/device-key", { keyProof: proof });
    const r = readDevice();
    if (me() === owner && r.held) writeDevice({ ...r, registered: true });
  } catch { /* offline or no proof yet: the next unlock with the device tries again */ }
}
/** Android, for a new password without the old one (core/deviceKey.ts): the data key from the Keystore, after the
 *  prompt. The caller zeroes it. */
export async function openDeviceKey(): Promise<Uint8Array> {
  const n = nativeLock();
  if (!n || !held(readDevice())) throw new Error("This device doesn't hold your journal's key. Turn on device verification first.");
  return fromBase64url(await n.unwrap());
}

/** Opens the journal with the device's verification. Throws when cancelled or when it can't be used any more. */
export async function unlockWithDevice(): Promise<void> {
  const n = nativeLock(), r = readDevice();
  if (n && held(r)) {
    const key = fromBase64url(await n.unwrap());
    try {
      keyring.set(key);
      if (!r.registered) void registerHeldKey(await keyProof(key));
    } finally { key.fill(0); }
    return;
  }
  const cred = readDevice().cred;
  if (!cred) throw new Error("Device verification isn't set up");
  const prfSalt = fromBase64url(cred.prfSalt);
  const output = await askPrf(fromBase64url(cred.credentialId), prfSalt);
  if (!output) throw new Error("This device didn't release the key");
  let kek: Uint8Array | undefined;
  try {
    kek = await kekFrom(output, prfSalt);
    const key = await openWithDevice(cred.wrapped, kek);
    try { keyring.set(key); } finally { key.fill(0); }
  } finally { kek?.fill(0); wipePrf(output); }
}

/** Signing out leaves nothing that could open this person's journal here. */
export function forgetUnlock(userId: string, at = place()) {
  // the Keystore-wrapped key too: a phone signed out (by itself, or by "sign out everywhere" after a loss) keeps no way in
  nativeLock()?.forgetFor(userId, at);
  writeJson(unlockRecordName(BUNDLE, at, userId), null);
  writeJson(unlockRecordName(DEVICE, at, userId), null);
}
/** Someone is signed in: what another person's ended session left on this device goes, older records without an owner too.
 *  Not another account saved in this app: switching back to it has to unlock offline. */
export function forgetUnlocksOfOthers(userId: string) {
  // Updating from a version that kept one record per server (no owner): the signed-in person's own copy may not exist
  // yet, and this is all that lets them unlock with the password offline. The bundle is only wrapped by a password,
  // so under the wrong person it just fails to open; the device's wrapped key is never adopted, it goes below.
  const old = `${BUNDLE}:${place()}`;
  const legacy = readJson<UnlockBundle | null>(old, null);
  if (legacy && typeof legacy.salt === "string" && typeof legacy.wrappedByPassword === "string" && !readJson(unlockRecordName(BUNDLE, place(), userId), null)) writeOwn(BUNDLE, legacy, userId);
  for (const kind of [BUNDLE, DEVICE]) for (const n of unlockRecordsToForget(storedKeys(), kind, place(), userId, savedUserIds())) writeJson(n, null);
}
