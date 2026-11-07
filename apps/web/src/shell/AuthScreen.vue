<script setup lang="ts">
// Sign in, create the first (admin) account, or join with an invite. The password stays on this device: Argon2id
// turns it into authKey (sent) and encKey (opens the journal's data key from the envelope the server hands back,
// PLAN.md §4.1). With two-factor on, the server asks for a code before it answers. "Forgot password?" (§4.4) takes the
// recovery key (opens the journal here, sets a new password, makes a new key) or a reset code from the admin (a new
// password, with the journal sealed until the recovery key opens it; no device can: the reset signed them out, which forgets their keys, LDJ-10).
// Straight after sign-up it offers to make the recovery key; skipping leaves Settings → Security's checklist warning.
import { ref, computed, onBeforeUnmount, watch } from "vue";
import { createAccountKeys, keyProof, openWithEncKey, passwordProblem, PASSWORD_MIN } from "@somnium/shared";
import { api, newSessionEra } from "../api/client";
import { session, loadSession } from "../core/session";
import { deviceId } from "../core/prefs";
import { keyring } from "../core/keyring";
import { keysFor, type SignInKeys } from "../core/auth";
import { lockNow, markUnlocked } from "../core/lock";
import { rememberBundle } from "../core/unlock";
import { registerKeyProof } from "../core/deviceKey";
import { downloadRecoveryKey, finishRecovery, makeRecoveryKey, openRecovery, type OpenedRecovery } from "../core/recovery";
import Logo from "./Logo.vue";
import { current, setToken } from "../native/accounts";

// in the desktop and Android apps: back to the list of accounts and servers on this device
const accounts = (globalThis as any).somniumNative?.accounts;

const mode = ref<"login" | "register">("login");
const f = ref({ username: "", password: "", displayName: "", invite: new URLSearchParams(location.search).get("invite") ?? "" });
if (f.value.invite) mode.value = "register";
// after the password: the second factor. backup = the code field takes a one-time backup code instead
const step = ref<"form" | "code" | "forgot" | "reset" | "recovery" | "recoveryPassword" | "newKey" | "offerKey" | "resetDone">("form");
const code = ref(""), backup = ref(false);
const err = ref(""), busy = ref<"" | "unlock" | "send">("");
// the reset code form, and what comes back: the sentence to show, and the sign-in to finish when it has been read
const reset = ref({ code: "", password: "" });
const resetMessage = ref("");
let resetSignIn: unknown = null;
const setup = computed(() => session.setupNeeded);
const creating = computed(() => setup.value || mode.value === "register");
let keys: SignInKeys | null = null; // kept between the password step and the code step, so Argon2id runs once
// the recovery key: what was typed, the data key it opened (held until the new key has been shown), and the new key
const rec = ref({ key: "", password: "", confirm: "", code: "" });
let opened: OpenedRecovery | null = null;
const newKey = ref(""), saved = ref(false), totpNeeded = ref(false);
// after the new key is read: the sign-in to finish with, and the data key it opens
let pending: { r: any; dataKey: Uint8Array } | null = null;

// the Android app signs in to its server with a token (it isn't on the server's own address, so no cookie)
const app = current()?.kind === "server";
const device = () => ({ deviceId: deviceId(), deviceName: app ? "Android app" : navigator.userAgent.includes("Android") ? "Android browser" : "Browser", ...(app ? { wantToken: true, platform: "android" } : {}) });

async function finish(r: any, encKey: Uint8Array | null, dataKey?: Uint8Array) {
  if (app && r?.token) setToken(r.token);
  // the server keeps the data key only wrapped by the password: open it here, never there
  if (dataKey) keyring.set(dataKey);
  else if (encKey && r?.wrappedByPassword) {
    const opened = await openWithEncKey({ salt: r.kdfSalt, wrappedByPassword: r.wrappedByPassword }, encKey);
    try { keyring.set(opened); } finally { opened.fill(0); } // the keyring has its own copy
  }
  else keyring.clear(); // after an admin reset: signed in, journal sealed until the recovery key re-wraps it
  newSessionEra(); // a late 401 from the session before says nothing about this one
  // the password was just proven: no lock screen straight after signing in - unless nothing opened the journal, and
  // then the lock screen is where the recovery key brings it back
  if (keyring.isOpen()) markUnlocked(); else lockNow();
  const proven = keys?.authKeyText ?? null;
  keys = null; f.value.password = ""; code.value = "";
  await loadSession();
  // the password was just proven: the server learns this account's key proof now (LDJ-10, core/deviceKey.ts)
  if (proven && keyring.isOpen()) void registerKeyProof(proven);
  // the lock screen opens the journal with this, also without a connection. It is this person's: known only from here on.
  if (r?.kdfSalt && session.user) rememberBundle({ salt: r.kdfSalt, wrappedByPassword: r.wrappedByPassword ?? null });
}

async function go() {
  err.value = "";
  try {
    const username = f.value.username.trim().toLowerCase();
    if (creating.value) {
      const problem = await passwordProblem(f.value.password);
      if (problem) { err.value = problem; return; }
      busy.value = "unlock";
      const made = await createAccountKeys(f.value.password);
      try {
        busy.value = "send";
        const r = await api.post("/auth/sign-up", { username, displayName: f.value.displayName, invite: f.value.invite, authKey: made.authKey, kdfSalt: made.salt, wrappedByPassword: made.wrappedByPassword, keyProof: await keyProof(made.dataKey), ...device() });
        if (app && r?.token) setToken(r.token); // the recovery key is sent with this account's session
        // hold on until the recovery key is made or skipped: the next step needs the data key and the authKey
        pending = { r: { ...r, kdfSalt: made.salt, wrappedByPassword: made.wrappedByPassword }, dataKey: new Uint8Array(made.dataKey) };
        signUpAuthKey = made.authKey;
        f.value.password = ""; saved.value = false; newKey.value = "";
        step.value = "offerKey";
      } finally { made.dataKey.fill(0); }
      return;
    }
    if (step.value === "form") { busy.value = "unlock"; keys = await keysFor(username, f.value.password); }
    busy.value = "send";
    const r = await api.post("/auth/sign-in", { username, authKey: keys!.authKeyText, ...(step.value === "code" ? { code: code.value } : {}), ...device() });
    if (r?.totpRequired) { step.value = "code"; return; }
    await finish(r, keys!.encKey);
  } catch (e) {
    err.value = (e as Error).message;
    if ((e as any)?.status === 401 && step.value === "form") keys = null;
  } finally { busy.value = ""; }
}
function back() { step.value = "form"; code.value = ""; err.value = ""; keys = null; dropRecovery(); }

// ----- the recovery key -----
let signUpAuthKey = "";
// the held data key goes as soon as the key steps are left any other way than Continue / Skip (which use it)
function dropPending() { pending?.dataKey.fill(0); pending = null; signUpAuthKey = ""; newKey.value = ""; }
watch(step, (now, before) => {
  const held = (s: string) => s === "newKey" || s === "offerKey";
  if (held(before) && !held(now)) dropPending();
});
onBeforeUnmount(dropPending);
function dropRecovery() { opened?.dataKey.fill(0); opened = null; rec.value = { key: "", password: "", confirm: "", code: "" }; totpNeeded.value = false; }
// straight after sign-up: make it now, while the data key is still here
async function makeFirstKey() {
  if (!pending) return;
  err.value = ""; busy.value = "unlock";
  try { newKey.value = await makeRecoveryKey(signUpAuthKey, pending.dataKey); signUpAuthKey = ""; step.value = "newKey"; }
  catch (e) { err.value = (e as Error).message; } finally { busy.value = ""; }
}
// the new key has been shown (or making one was skipped): sign in with what was held
async function leaveWithKey() {
  const p = pending; pending = null; signUpAuthKey = ""; newKey.value = "";
  if (!p) { back(); return; }
  try { await finish(p.r, null, p.dataKey); } catch (e) { err.value = (e as Error).message; step.value = "form"; } finally { p.dataKey.fill(0); }
}
async function checkKey() {
  err.value = ""; busy.value = "unlock";
  try {
    const typed = rec.value.key;
    dropRecovery(); // a key opened before (Back, then another try) is let go first
    opened = await openRecovery(f.value.username, typed);
    totpNeeded.value = opened.totpRequired;
    rec.value = { key: "", password: "", confirm: "", code: "" };
    step.value = "recoveryPassword";
  } catch (e) { err.value = (e as Error).name === "SealError" ? "That recovery key is not right" : (e as Error).message; } finally { busy.value = ""; }
}
async function setPasswordWithKey() {
  if (!opened) { step.value = "recovery"; return; }
  err.value = "";
  const problem = await passwordProblem(rec.value.password);
  if (problem) { err.value = problem; return; }
  if (rec.value.password !== rec.value.confirm) { err.value = "The two passwords are not the same"; return; }
  busy.value = "unlock";
  try {
    const done = await finishRecovery(opened, rec.value.password, rec.value.code, device());
    pending = { r: { ok: true, token: done.token, kdfSalt: done.kdfSalt, wrappedByPassword: done.wrappedByPassword }, dataKey: new Uint8Array(opened.dataKey) };
    if (app && done.token) setToken(done.token);
    newKey.value = done.recoveryKey; saved.value = false;
    dropRecovery();
    step.value = "newKey";
  } catch (e) {
    err.value = (e as Error).message;
    if ((e as any)?.status === 403 && !/code/.test(err.value)) { dropRecovery(); step.value = "recovery"; } // the key was used meanwhile
  } finally { busy.value = ""; }
}
const copyKey = async () => { try { await navigator.clipboard.writeText(newKey.value); } catch { err.value = "Could not copy. Write it down instead."; } };

// A new password from a reset code. Only the new authKey and salt are sent: the journal's data key is lost to this
// device until the recovery key brings it back (no device can: the reset signed them out and each forgot its key, LDJ-10), so the fresh one made
// alongside is never used.
async function sendReset() {
  err.value = "";
  try {
    const username = f.value.username.trim().toLowerCase();
    const problem = await passwordProblem(reset.value.password);
    if (problem) { err.value = problem; return; }
    busy.value = "unlock";
    const made = await createAccountKeys(reset.value.password);
    made.dataKey.fill(0); // never used: see above
    busy.value = "send";
    const r = await api.post("/auth/reset", { username, code: reset.value.code, authKey: made.authKey, kdfSalt: made.salt });
    resetMessage.value = r.message;
    reset.value = { code: "", password: "" };
    // the password is set even if this sign-in does not go through: then the button leads to the sign-in form
    resetSignIn = await api.post("/auth/sign-in", { username, authKey: made.authKey, ...device() }).catch(() => null);
    step.value = "resetDone";
  } catch (e) { err.value = (e as Error).message; } finally { busy.value = ""; }
}
async function leaveReset() {
  if (resetSignIn) await finish(resetSignIn, null);
  else back();
}
</script>

<template>
  <div class="auth" role="main">
    <form v-if="step === 'code'" class="card" @submit.prevent="go">
      <Logo />
      <h1>One more step</h1>
      <p class="muted auth-lede">{{ backup ? "Type one of your backup codes. It works once." : "Type the code from your authenticator app." }}</p>
      <div class="fld"><label>{{ backup ? "Backup code" : "6-digit code" }}</label><input :aria-label="backup ? 'Backup code' : '6-digit code'" v-model="code" :inputmode="backup ? 'text' : 'numeric'" :maxlength="backup ? 11 : 6" autocomplete="one-time-code" autocapitalize="characters" autofocus required /></div>
      <div v-if="err" class="err">{{ err }}</div>
      <button class="btn block lg" :disabled="!!busy">{{ busy ? "Signing in..." : "Sign in" }}</button>
      <p class="center tiny auth-link"><a class="acc click" href="#" role="button" @click.prevent="backup = !backup; code = ''">{{ backup ? "Use the authenticator app instead" : "Lost the authenticator? Use a backup code" }}</a></p>
      <p class="center tiny auth-link"><a class="acc click" href="#" role="button" @click.prevent="back">Back</a></p>
    </form>
    <div v-else-if="step === 'forgot'" class="card">
      <Logo />
      <h1>Forgot password?</h1>
      <p class="muted auth-lede">What do you have?</p>
      <div class="auth-choices">
        <button type="button" class="btn o block" @click="step = 'reset'; err = ''">I have a reset code</button>
        <button type="button" class="btn o block" @click="step = 'recovery'; err = ''">I have a recovery key</button>
      </div>
      <p class="center tiny auth-link"><a class="acc click" href="#" role="button" @click.prevent="back">Back</a></p>
    </div>
    <form v-else-if="step === 'recovery'" class="card" @submit.prevent="checkKey">
      <Logo />
      <h1>Recovery key</h1>
      <p class="muted auth-lede">The 20-character key you saved when you made it. It opens your journal and lets you choose a new password.</p>
      <div class="fld"><label>Username</label><input aria-label="Username" v-model="f.username" autocomplete="username" autocapitalize="off" required /></div>
      <div class="fld"><label>Recovery key</label><input aria-label="Recovery key" v-model="rec.key" class="mono" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX" required /></div>
      <div v-if="err" class="err" role="alert">{{ err }}</div>
      <button class="btn block lg" :disabled="!!busy">{{ busy ? "Checking..." : "Next" }}</button>
      <p class="center tiny auth-link"><a class="acc click" href="#" role="button" @click.prevent="step = 'forgot'; err = ''">Back</a></p>
    </form>
    <form v-else-if="step === 'recoveryPassword'" class="card" @submit.prevent="setPasswordWithKey">
      <Logo />
      <h1>Choose a new password</h1>
      <p class="muted auth-lede">Your recovery key is right. The new password seals your journal from now on, and you get a new recovery key - the one you typed stops working.</p>
      <input class="auth-hidden" type="text" autocomplete="username" :value="f.username" readonly tabindex="-1" aria-hidden="true" />
      <div class="fld"><label>New password</label><input aria-label="New password" v-model="rec.password" type="password" autocomplete="new-password" required :minlength="PASSWORD_MIN" autofocus /><p class="tiny auth-hint">At least {{ PASSWORD_MIN }} characters.</p></div>
      <div class="fld"><label>New password again</label><input aria-label="New password again" v-model="rec.confirm" type="password" autocomplete="new-password" required :minlength="PASSWORD_MIN" /></div>
      <div v-if="totpNeeded" class="fld"><label>Code from your authenticator, or a backup code</label><input v-model="rec.code" autocomplete="one-time-code" autocapitalize="characters" maxlength="11" required /></div>
      <div v-if="err" class="err" role="alert">{{ err }}</div>
      <button class="btn block lg" :disabled="!!busy">{{ busy ? "Setting your password..." : "Set password" }}</button>
      <p class="center tiny auth-link"><a class="acc click" href="#" role="button" @click.prevent="back">Cancel</a></p>
    </form>
    <div v-else-if="step === 'offerKey'" class="card">
      <Logo />
      <h1>Make your recovery key</h1>
      <p class="muted auth-lede">Nobody can send you your password, the admin included. The recovery key is the way back in if you forget it. It takes a second, and you see it once.</p>
      <div v-if="err" class="err" role="alert">{{ err }}</div>
      <button type="button" class="btn block lg" :disabled="!!busy" @click="makeFirstKey">{{ busy ? "Making your key..." : "Make recovery key" }}</button>
      <p class="center tiny auth-link"><a class="acc click" href="#" role="button" @click.prevent="leaveWithKey">Skip for now</a></p>
      <p class="center tiny muted auth-link">You can make it later in Settings · Security.</p>
    </div>
    <div v-else-if="step === 'newKey'" class="card">
      <Logo />
      <h1>Your recovery key</h1>
      <p class="muted auth-lede">Save it somewhere safe and private - a password manager, or printed. It is shown only now. Anyone with it and your username can open your journal.</p>
      <code class="key-display">{{ newKey }}</code>
      <div class="auth-row"><button type="button" class="qb" @click="copyKey">Copy</button><button type="button" class="qb" @click="downloadRecoveryKey(f.username.trim().toLowerCase(), newKey)">Download as text</button></div>
      <label class="auth-check"><input v-model="saved" type="checkbox" /> I saved my recovery key</label>
      <div v-if="err" class="err" role="alert">{{ err }}</div>
      <button type="button" class="btn block lg" :disabled="!saved" @click="leaveWithKey">Continue</button>
    </div>
    <form v-else-if="step === 'reset'" class="card" @submit.prevent="sendReset">
      <Logo />
      <h1>Set a new password</h1>
      <p class="muted auth-lede">Your admin can give you a reset code. It works once, for one day.</p>
      <div class="fld"><label>Username</label><input aria-label="Username" v-model="f.username" autocomplete="username" autocapitalize="off" required /></div>
      <div class="fld"><label>Reset code</label><input aria-label="Reset code" v-model="reset.code" maxlength="11" autocomplete="off" autocapitalize="characters" required /></div>
      <div class="fld"><label>New password</label><input aria-label="New password" v-model="reset.password" type="password" autocomplete="new-password" required :minlength="PASSWORD_MIN" /><p class="tiny auth-hint">At least {{ PASSWORD_MIN }} characters.</p></div>
      <div v-if="err" class="err">{{ err }}</div>
      <button class="btn block lg" :disabled="!!busy">{{ busy ? "Setting your password..." : "Set password" }}</button>
      <p class="center tiny auth-link"><a class="acc click" href="#" role="button" @click.prevent="step = 'forgot'; err = ''">Back</a></p>
    </form>
    <div v-else-if="step === 'resetDone'" class="card">
      <Logo />
      <h1>Password set</h1>
      <p class="muted auth-lede">{{ resetMessage }}</p>
      <button type="button" class="btn block lg" @click="leaveReset">Continue</button>
    </div>
    <form v-else class="card" @submit.prevent="go">
      <Logo />
      <h1>{{ setup ? "Welcome to Somnium" : mode === "login" ? "Sign in" : "Create your account" }}</h1>
      <p class="muted auth-lede">{{ setup ? "Create the first account. It will be the admin of this server." : mode === "login" ? "Your dreams, sealed." : "You need an invite code from the admin." }}</p>
      <div v-if="creating" class="fld"><label>Your name</label><input v-model="f.displayName" autocomplete="name" /></div>
      <div class="fld"><label>Username</label><input aria-label="Username" v-model="f.username" autocomplete="username" autocapitalize="off" required /></div>
      <div class="fld"><label>Password</label><input aria-label="Password" v-model="f.password" type="password" :autocomplete="creating ? 'new-password' : 'current-password'" required :minlength="creating ? PASSWORD_MIN : undefined" />
        <p v-if="creating" class="tiny auth-hint">At least {{ PASSWORD_MIN }} characters. It seals your journal: the server never sees it, so nobody can send it to you if it is lost - you will get a recovery key.</p></div>
      <div v-if="!setup && mode === 'register' && session.registration === 'invite'" class="fld"><label>Invite code</label><input v-model="f.invite" required /></div>
      <div v-if="err" class="err">{{ err }}</div>
      <button class="btn block lg" :disabled="!!busy">{{ busy === "unlock" ? "Unlocking..." : busy ? (creating ? "Creating..." : "Signing in...") : creating ? "Create account" : "Sign in" }}</button>
      <p v-if="!setup && mode === 'login'" class="center tiny auth-link"><a class="acc click" href="#" role="button" @click.prevent="step = 'forgot'; err = ''">Forgot password?</a></p>
      <p v-if="!setup && session.registration !== 'closed'" class="center tiny auth-link">
        <a v-if="mode === 'login'" class="acc click" href="#" role="button" @click.prevent="mode = 'register'; err = ''">Have an invite? Create an account</a>
        <a v-else class="acc click" href="#" role="button" @click.prevent="mode = 'login'; err = ''">Already have an account? Sign in</a>
      </p>
      <p v-if="accounts" class="center tiny auth-link"><a class="acc click" href="#" role="button" @click.prevent="accounts.chooser()">Other accounts and servers</a></p>
    </form>
  </div>
</template>

<style scoped>
.auth-lede { margin-bottom: var(--cpy); font-size: var(--fs-sm); }
.auth-link { margin-top: var(--cpy); }
.auth-hint { margin-top: var(--hg); }
.auth-choices { display: flex; flex-direction: column; gap: var(--hg); }
.auth-row { display: flex; justify-content: center; gap: var(--hg); flex-wrap: wrap; margin: var(--hg) 0; }
.auth-check { display: flex; align-items: center; gap: var(--hg); margin-bottom: var(--cpy); font-size: var(--fs-sm); }
.auth-hidden { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
</style>
