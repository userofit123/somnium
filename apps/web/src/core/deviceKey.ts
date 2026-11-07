// Device keys (LDJ-10, PLAN.md §4.4): a phone that holds the data key (Android Keystore, core/unlock.ts) can set a new
// password when the old one is forgotten, from Settings → Security, verified by the phone itself.
//
// The server never sees the data key. It checks keyProof (a one-way value made from the data key, @somnium/shared),
// whose hash it registered while the password was proven: at sign-up, or right after signing in (registerKeyProof
// here, with the authKey just sent). A stolen session alone can't register one of its own. The route also needs this
// sign-in to have registered a device key, counts a wrong proof like a wrong password, and asks for the authenticator
// code when two-factor is on. A local account has no server: its record is re-wrapped on the phone after the prompt.
//
// The desktop app is left out: Electron's safeStorage opens for anyone at the signed-in computer, without asking.
import { changePassword, constantTimeEqual, keyProof } from "@somnium/shared";
import { api } from "../api/client";
import { keyring } from "./keyring";
import { setLocalPasswordFromDevice } from "./localLock";
import { isLocalAccount } from "./session";
import { deviceStatus, nativeLock, openDeviceKey, rememberBundle } from "./unlock";

/** Right after signing in with the password: the server learns this account's key proof, once (the first one stays). */
export async function registerKeyProof(authKey: string): Promise<void> {
  const key = keyring.get();
  if (!key) return;
  try { await api.post("/auth/key-proof", { authKey, keyProof: await keyProof(key) }); }
  catch { /* offline, or an older server: the next sign-in tries again */ }
  finally { key.fill(0); }
}

/** Whether this device can set a new password without the old one: the Android app, with device verification on. */
export const deviceCanSetPassword = () => !!nativeLock() && deviceStatus().on;

/**
 * A new password without the old one. The phone's prompt releases the data key; it must be the journal's open key
 * (or the server's proof check refuses it), then it is re-wrapped under the new password. Throws NotAllowedError when
 * the prompt was cancelled, and the server's answer otherwise (totpRequired: ask for a code and call again).
 * The caller checks the password's rules and wraps this in whileVerifying (the prompt hides the page for a moment).
 */
export async function setPasswordFromDevice(next: string, code?: string): Promise<void> {
  const key = await openDeviceKey();
  try {
    const open = keyring.get();
    // the journal is open in Settings: the key the phone held must be that one, or nothing is re-wrapped
    try { if (!open || !constantTimeEqual(open, key)) throw new Error("This phone's key doesn't open this journal. Use your password."); }
    finally { open?.fill(0); }
    if (await isLocalAccount()) { await setLocalPasswordFromDevice(key, next); return; }
    const pw = await changePassword(key, next);
    await api.post("/auth/password/device", { keyProof: await keyProof(key), authKey: pw.authKey, kdfSalt: pw.salt, wrappedByPassword: pw.wrappedByPassword, ...(code ? { code } : {}) });
    rememberBundle({ salt: pw.salt, wrappedByPassword: pw.wrappedByPassword }); // the lock screen takes the new password from now on
  } finally { key.fill(0); }
}
