<script setup lang="ts">
// The lock screen (PLAN.md §4.3): opaque, with nothing of the journal behind it (App.vue keeps the shells unmounted).
// A successful unwrap of the data key is the proof, so this works without a connection. After five wrong tries in a
// row each further try waits longer; nothing is ever deleted or signed out for it. Wrong tries are wrong passwords and
// device verifications that answer with the wrong thing: a cancelled verification or no connection never counts.
// While a wait runs, a try is refused before the password is looked at.
// The recovery key (PLAN.md §4.4) opens the journal here too: after an admin reset (the sealed state: no password wraps
// the data key) and when the password is forgotten. It re-wraps the data key under the password typed with it, makes a
// new recovery key and signs the other devices out. Wrong keys are counted by the server, like sign-in tries.
// When sealed, "Your password" is the one this session signed in with: the server checks it (as `current`) before it
// re-wraps anything, so a typo is refused rather than becoming the new password. Otherwise it is a new password, typed
// twice.
// A local account (LDJ-53) works the same way with its own envelope, kept in the account's record on this device
// (core/localLock.ts): the password opens it, the recovery key sets a new one, wrong tries wait the same. One made
// before local accounts had passwords is asked to set one here, and what it holds is then sealed in place.
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { FREE_WRONG_TRIES, PASSWORD_MIN, deviceFailureCounts, formatWait, passwordProblem } from "@somnium/shared";
import { isLocalAccount, session, signOut, unsentChanges } from "../core/session";
import { keyOpenedOnLockScreen, lock, markUnlocked, whileVerifying, wrongTry, wrongTryWait } from "../core/lock";
import { keyring } from "../core/keyring";
import { authKeyFor } from "../core/auth";
import { downloadRecoveryKey, finishRecovery, openRecovery } from "../core/recovery";
import { hasLocalRecoveryKey, localKeys, makeLocalRecoveryKey, recoverLocalAccount, sealJournalInPlace, setUpLocalPassword, unlockLocal } from "../core/localLock";
import { cachedBundle, rememberBundle, declineDevice, deviceStatus, deviceVerifierExists, freshBundle, setUpDevice, shouldOfferDevice, unlockWithDevice, unlockWithPassword, type UnlockBundle } from "../core/unlock";
import Logo from "./Logo.vue";

type Step = "loading" | "password" | "device" | "offer" | "noPrf" | "recovery" | "newKey" | "signOut" | "localSetup" | "offerKey";
const step = ref<Step>("loading");
const password = ref(""), err = ref(""), busy = ref(false);
const bundle = ref<UnlockBundle | null>(cachedBundle());
const canUseDevice = ref(false);
const pwInput = ref<HTMLInputElement | null>(null);
const rec = ref({ key: "", password: "", confirm: "", code: "" });
const totpNeeded = ref(false), newKey = ref(""), saved = ref(false);
// a local account: no server, its keys in its own record. firstKey: the key shown is its first, not a replacement
const local = ref(false), firstKey = ref(false), setup = ref({ password: "", confirm: "" });
const accountsApi = () => (globalThis as { somniumNative?: { accounts?: { chooser?: () => void } } }).somniumNative?.accounts;
// the server's answer, when it comes, replaces the copy on this device; a try waits for it
let loaded: Promise<void> = Promise.resolve();

const sealed = computed(() => !local.value && !!bundle.value && !bundle.value.wrappedByPassword);
const who = computed(() => (local.value ? "On this device" : `@${session.user?.username ?? ""}`));
const keyOwner = () => (local.value ? "your journal on this device" : session.user?.username ?? "");
const triesLeft = computed(() => FREE_WRONG_TRIES - lock.wrongTries);
const triesText = computed(() => (lock.wrongTries === 0 || triesLeft.value <= 0 ? "" : `${triesLeft.value} ${triesLeft.value === 1 ? "try" : "tries"} left, then each try has to wait.`));
const waiting = computed(() => lock.waitMs > 0);
const waitText = computed(() => `Too many wrong tries. Try again in ${formatWait(lock.waitMs)}. Your journal stays locked.`);
const unsent = computed(() => unsentChanges());

const showPassword = () => { step.value = "password"; err.value = ""; void nextTick(() => pwInput.value?.focus()); };

onMounted(async () => {
  if (await isLocalAccount()) {
    local.value = true;
    try { if (await localKeys()) showPassword(); else step.value = "localSetup"; }
    catch { step.value = "localSetup"; err.value = "This app couldn't read this account's keys. Try again."; }
    return;
  }
  loaded = freshBundle().then((b) => { bundle.value = b; });
  canUseDevice.value = deviceStatus().on && (await deviceVerifierExists());
  if (canUseDevice.value) step.value = "device"; else showPassword();
});
// left the app while offering device verification: the key was dropped, so this starts over
const stop = keyring.onChange((open) => { if (!open && (step.value === "offer" || step.value === "noPrf")) showPassword(); });
onBeforeUnmount(() => { stop(); password.value = ""; });

// the key can go while a step here waits (leaving the app, the idle time): the journal never opens without it
function openJournal() {
  if (!keyring.isOpen()) { showPassword(); return; }
  markUnlocked();
}

async function unlock() {
  if (busy.value || wrongTryWait() > 0) return;
  err.value = ""; busy.value = true;
  try {
    if (local.value) {
      const right = await unlockLocal(password.value);
      password.value = "";
      if (!right) { wrongTry(); err.value = waiting.value ? "" : `Wrong password. ${triesText.value}`; await nextTick(); pwInput.value?.focus(); return; }
      keyOpenedOnLockScreen();
      await sealOldJournal();
      openJournal();
      return;
    }
    await loaded;
    const b = bundle.value;
    if (!b) { err.value = "Can't reach your server, and this device has nothing saved to unlock with yet. Try again with a connection."; return; }
    if (!b.wrappedByPassword) return;
    const right = await unlockWithPassword({ salt: b.salt, wrappedByPassword: b.wrappedByPassword }, password.value);
    password.value = "";
    if (!right) {
      wrongTry();
      err.value = waiting.value ? "" : `Wrong password. ${triesText.value}`;
      await nextTick(); pwInput.value?.focus();
      return;
    }
    keyOpenedOnLockScreen();
    if ((await shouldOfferDevice()) && keyring.isOpen()) { step.value = "offer"; return; }
    openJournal();
  } catch { err.value = "Something went wrong. Your password wasn't counted as wrong. Try again."; }
  finally { busy.value = false; }
}

async function useDevice() {
  if (busy.value || wrongTryWait() > 0) return;
  err.value = ""; busy.value = true;
  try {
    await whileVerifying(unlockWithDevice);
    openJournal();
  } catch (e) {
    if (deviceFailureCounts(e)) wrongTry();
    err.value = waiting.value ? "" : (e as Error)?.name === "NotAllowedError" ? "Verification was cancelled or timed out." : "This device couldn't open your journal. Use your password.";
  } finally { busy.value = false; }
}

// straight after a password unlock, so the browser sees it as the person's own doing
async function setUp() {
  if (busy.value) return;
  err.value = ""; busy.value = true;
  try {
    const r = await whileVerifying(() => setUpDevice(session.user?.username ?? "me"));
    if (r === "noPrf") { step.value = "noPrf"; return; }
    openJournal();
  } catch { err.value = "Verification was cancelled. You can turn it on later in Settings · Security."; declineDevice(); }
  finally { busy.value = false; }
}
function notNow() { declineDevice(); openJournal(); }

// An account made before passwords: what it holds is sealed now. If that fails the journal still opens (older
// plaintext reads as it is and everything new is sealed), and it is tried again on the next unlock.
async function sealOldJournal() {
  try { await sealJournalInPlace(); } catch (e) { console.warn("Sealing this journal in place didn't finish:", (e as Error).message); }
}

// ----- a local account's first password -----
async function setUpLocal() {
  if (busy.value) return;
  err.value = "";
  const problem = await passwordProblem(setup.value.password);
  if (problem) { err.value = problem; return; }
  if (setup.value.password !== setup.value.confirm) { err.value = "The two passwords are not the same"; return; }
  busy.value = true;
  try {
    await setUpLocalPassword(setup.value.password);
    setup.value = { password: "", confirm: "" };
    keyOpenedOnLockScreen();
    await sealOldJournal();
    step.value = "offerKey";
  } catch (e) { err.value = (e as Error).message; }
  finally { busy.value = false; }
}
async function makeFirstKey() {
  if (busy.value) return;
  err.value = ""; busy.value = true;
  try { newKey.value = await makeLocalRecoveryKey(); firstKey.value = true; saved.value = false; step.value = "newKey"; }
  catch (e) { err.value = (e as Error).message; } finally { busy.value = false; }
}

function showRecovery() { step.value = "recovery"; err.value = ""; rec.value = { key: "", password: "", confirm: "", code: "" }; }
// one step: the key is checked and opened, then the password re-wraps it. The key is the proof, so no wrong-try count
// here: the server counts wrong keys for this account and makes them wait.
async function useRecoveryKey() {
  if (busy.value) return;
  err.value = ""; busy.value = true;
  let dataKey: Uint8Array | null = null;
  try {
    if (local.value) {
      if (wrongTryWait() > 0) return;
      if (!hasLocalRecoveryKey(await localKeys())) { err.value = "No recovery key was made for this account, so only its password can open it."; return; }
      const problem = await passwordProblem(rec.value.password);
      if (problem) { err.value = problem; return; }
      if (rec.value.password !== rec.value.confirm) { err.value = "The two passwords are not the same"; return; }
      let made: string;
      try { made = await recoverLocalAccount(rec.value.key, rec.value.password); }
      catch (e) {
        if ((e as Error).name !== "SealError") throw e;
        // no server counts wrong keys here, so the lock's own count does
        wrongTry(); err.value = waiting.value ? waitText.value : "That recovery key is not right"; return;
      }
      rec.value = { key: "", password: "", confirm: "", code: "" };
      newKey.value = made; firstKey.value = false; saved.value = false;
      step.value = "newKey";
      return;
    }
    const isSealed = sealed.value;
    if (!isSealed) {
      const problem = await passwordProblem(rec.value.password);
      if (problem) { err.value = problem; return; }
      if (rec.value.password !== rec.value.confirm) { err.value = "The two passwords are not the same"; return; }
    }
    const opened = await openRecovery(session.user?.username ?? "", rec.value.key);
    dataKey = opened.dataKey;
    if (opened.totpRequired && !rec.value.code) { totpNeeded.value = true; err.value = "Type the code from your authenticator app, or a backup code."; return; }
    const current = isSealed ? { current: await authKeyFor(session.user?.username ?? "", rec.value.password) } : {};
    const done = await finishRecovery(opened, rec.value.password, rec.value.code, current);
    rememberBundle({ salt: done.kdfSalt, wrappedByPassword: done.wrappedByPassword });
    bundle.value = { salt: done.kdfSalt, wrappedByPassword: done.wrappedByPassword };
    keyring.set(dataKey);
    rec.value = { key: "", password: "", confirm: "", code: "" };
    newKey.value = done.recoveryKey; saved.value = false;
    step.value = "newKey";
  } catch (e) {
    err.value = (e as Error).name === "SealError" ? "That recovery key is not right" : (e as Error).message;
    if (/code/.test(err.value)) totpNeeded.value = true;
  } finally { dataKey?.fill(0); busy.value = false; }
}
async function copyKey() { try { await navigator.clipboard.writeText(newKey.value); } catch { err.value = "Could not copy. Write it down instead."; } }
async function leaveNewKey() {
  newKey.value = ""; keyOpenedOnLockScreen();
  if (local.value) await sealOldJournal();
  openJournal();
}

// a local account has nothing to sign out of: the way out is the list of accounts on this device
async function askSignOut() { if (local.value) { accountsApi()?.chooser?.(); return; } if (unsent.value) { step.value = "signOut"; err.value = ""; } else await leave(); }
async function leave() {
  if (busy.value) return;
  busy.value = true;
  try { await signOut({ force: true }); } finally { busy.value = false; }
}
</script>

<template>
  <div class="auth lock-screen" role="dialog" aria-modal="true" aria-label="Somnium is locked">
    <div v-if="step === 'loading'" class="card"><Logo /><h1>Locked</h1></div>

    <form v-else-if="step === 'localSetup'" class="card" @submit.prevent="setUpLocal">
      <Logo />
      <h1>Choose a password</h1>
      <p class="muted auth-lede">It seals your journal on this device and opens it each time. Nobody can send it to you if it is lost - you will get a recovery key next.</p>
      <input class="lock-user" type="text" autocomplete="username" value="Somnium on this device" readonly tabindex="-1" aria-hidden="true" />
      <div class="fld"><label for="lock-sp">Password</label><input id="lock-sp" v-model="setup.password" type="password" autocomplete="new-password" required :minlength="PASSWORD_MIN" autofocus /><p class="tiny lock-hint">At least {{ PASSWORD_MIN }} characters.</p></div>
      <div class="fld"><label for="lock-sp2">Password again</label><input id="lock-sp2" v-model="setup.confirm" type="password" autocomplete="new-password" required :minlength="PASSWORD_MIN" /></div>
      <div v-if="err" class="err" role="alert">{{ err }}</div>
      <button class="btn block lg" :disabled="busy">{{ busy ? "Sealing your journal..." : "Set password" }}</button>
      <p class="center tiny auth-link"><button type="button" class="lock-link muted" @click="askSignOut">Other accounts</button></p>
    </form>

    <div v-else-if="step === 'offerKey'" class="card">
      <Logo />
      <h1>Make your recovery key</h1>
      <p class="muted auth-lede">Nobody can send you your password. The recovery key is the way back in if you forget it. It takes a second, and you see it once.</p>
      <div v-if="err" class="err" role="alert">{{ err }}</div>
      <button type="button" class="btn block lg" :disabled="busy" @click="makeFirstKey">{{ busy ? "Making your key..." : "Make recovery key" }}</button>
      <p class="center tiny auth-link"><button type="button" class="lock-link acc" @click="openJournal">Skip for now</button></p>
      <p class="center tiny muted auth-link">You can make it later in Settings · Security.</p>
    </div>

    <div v-else-if="step === 'offer'" class="card">
      <Logo />
      <h1>Unlock with this device?</h1>
      <p class="muted auth-lede">Next time, use your fingerprint, face or screen lock instead of typing your password.</p>
      <div v-if="err" class="err">{{ err }}</div>
      <button v-if="!err" type="button" class="btn block lg" :disabled="busy" @click="setUp">{{ busy ? "Waiting for your device..." : "Turn on" }}</button>
      <button v-else type="button" class="btn block lg" @click="openJournal">Continue</button>
      <p v-if="!err" class="center tiny auth-link"><button type="button" class="lock-link acc" @click="notNow">Not now</button></p>
    </div>

    <div v-else-if="step === 'noPrf'" class="card">
      <Logo />
      <h1>Password it is</h1>
      <p class="muted auth-lede">This device can confirm it is you, but it can't keep your journal's key safe. Rather than store the key unprotected, Somnium will ask for your password here.</p>
      <button type="button" class="btn block lg" @click="openJournal">Continue</button>
    </div>

    <form v-else-if="step === 'recovery'" class="card" @submit.prevent="useRecoveryKey">
      <Logo />
      <h1>Recovery key</h1>
      <p class="muted auth-lede">{{ sealed ? "Your recovery key opens your journal again. Type the password you just signed in with: it is checked, and from here on it opens your journal too." : local ? "Your recovery key opens your journal and sets a new password." : "Your recovery key opens your journal and sets a new password. Your other devices are signed out." }}</p>
      <input class="lock-user" type="text" autocomplete="username" :value="local ? 'Somnium on this device' : session.user?.username" readonly tabindex="-1" aria-hidden="true" />
      <div v-if="local && waiting" class="err" role="status">{{ waitText }}</div>
      <div class="fld"><label for="lock-rk">Recovery key</label><input id="lock-rk" v-model="rec.key" class="mono" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX" required autofocus /></div>
      <div class="fld"><label for="lock-np">{{ sealed ? "Your password" : "New password" }}</label><input id="lock-np" v-model="rec.password" type="password" :autocomplete="sealed ? 'current-password' : 'new-password'" required :minlength="sealed ? undefined : PASSWORD_MIN" /></div>
      <div v-if="!sealed" class="fld"><label for="lock-np2">New password again</label><input id="lock-np2" v-model="rec.confirm" type="password" autocomplete="new-password" required :minlength="PASSWORD_MIN" /></div>
      <div v-if="totpNeeded" class="fld"><label for="lock-code">Code from your authenticator, or a backup code</label><input id="lock-code" v-model="rec.code" autocomplete="one-time-code" autocapitalize="characters" maxlength="11" required /></div>
      <div v-if="err" class="err" role="alert">{{ err }}</div>
      <button class="btn block lg" :disabled="busy">{{ busy ? "Opening..." : "Open journal" }}</button>
      <p class="center tiny auth-link"><button type="button" class="lock-link acc" @click="sealed ? (step = 'password') : showPassword()">Back</button></p>
    </form>

    <div v-else-if="step === 'newKey'" class="card">
      <Logo />
      <h1>{{ firstKey ? "Your recovery key" : "Your new recovery key" }}</h1>
      <p class="muted auth-lede">{{ firstKey ? "Save it somewhere safe and private - a password manager, or printed. It is shown only now. Anyone with it can open your journal on this device." : "The one you typed no longer works. Save this one somewhere safe and private - it is shown only now." }}</p>
      <code class="key-display">{{ newKey }}</code>
      <div class="lock-row"><button type="button" class="qb" @click="copyKey">Copy</button><button type="button" class="qb" @click="downloadRecoveryKey(keyOwner(), newKey)">Download as text</button></div>
      <label class="lock-check"><input v-model="saved" type="checkbox" /> I saved my recovery key</label>
      <div v-if="err" class="err" role="alert">{{ err }}</div>
      <button type="button" class="btn block lg" :disabled="!saved" @click="leaveNewKey">Open journal</button>
    </div>

    <div v-else-if="step === 'signOut'" class="card">
      <Logo />
      <h1>Sign out?</h1>
      <p class="muted auth-lede">{{ unsent }} change{{ unsent === 1 ? " hasn't" : "s haven't" }} reached the server yet. Signing out removes them from this device.</p>
      <button type="button" class="btn r block lg" :disabled="busy" @click="leave">Sign out anyway</button>
      <p class="center tiny auth-link"><button type="button" class="lock-link acc" @click="step = 'password'">Back</button></p>
    </div>

    <div v-else-if="sealed" class="card">
      <Logo />
      <h1>Your journal is sealed</h1>
      <!-- only the recovery key is promised: a reset signed every device out, and none keeps the key yet (LDJ-10) -->
      <p class="muted auth-lede">Your password was reset, so nothing here can open your dreams until your recovery key is entered.</p>
      <button type="button" class="btn block lg" @click="showRecovery">Enter recovery key</button>
      <p class="center tiny auth-link"><button type="button" class="lock-link acc" @click="askSignOut">Sign out</button></p>
    </div>

    <div v-else-if="step === 'device'" class="card">
      <Logo />
      <h1>Locked</h1>
      <p class="muted auth-lede">@{{ session.user?.username }}</p>
      <div v-if="waiting" class="err" role="status">{{ waitText }}</div>
      <div v-else-if="err" class="err">{{ err }}</div>
      <button type="button" class="btn block lg" :disabled="busy || waiting" @click="useDevice">{{ busy ? "Waiting for your device..." : "Unlock with this device" }}</button>
      <p class="center tiny auth-link"><button type="button" class="lock-link acc" @click="showPassword">Use password instead</button></p>
      <p class="center tiny auth-link"><button type="button" class="lock-link muted" @click="askSignOut">Sign out</button></p>
    </div>

    <form v-else class="card" @submit.prevent="unlock">
      <Logo />
      <h1>Locked</h1>
      <p class="muted auth-lede">{{ who }}</p>
      <!-- for password managers: which account this password is for -->
      <input class="lock-user" type="text" autocomplete="username" :value="local ? 'Somnium on this device' : session.user?.username" readonly tabindex="-1" aria-hidden="true" />
      <div class="fld"><label for="lock-pw">Password</label><input id="lock-pw" ref="pwInput" v-model="password" type="password" autocomplete="current-password" required /></div>
      <div v-if="waiting" class="err" role="status">{{ waitText }}</div>
      <div v-else-if="err" class="err" role="alert">{{ err }}</div>
      <p v-else-if="triesText" class="tiny lock-tries">{{ triesText }}</p>
      <button class="btn block lg" :disabled="busy || waiting">{{ busy ? "Unlocking..." : "Unlock" }}</button>
      <p v-if="canUseDevice" class="center tiny auth-link"><button type="button" class="lock-link acc" @click="step = 'device'; err = ''">Use this device instead</button></p>
      <p class="center tiny auth-link"><button type="button" class="lock-link acc" @click="showRecovery">Forgot password? Use your recovery key</button></p>
      <p class="center tiny auth-link"><button type="button" class="lock-link muted" @click="askSignOut">{{ local ? "Other accounts" : "Sign out" }}</button></p>
    </form>
  </div>
</template>

<style scoped>
/* Opaque and above everything: nothing shows through, on any theme. */
.lock-screen { position: fixed; inset: 0; z-index: 1000; overflow-y: auto; background: var(--bg); padding-top: var(--st, 0px); padding-bottom: var(--sb, 0px); }
.auth-lede { margin-bottom: var(--cpy); font-size: var(--fs-sm); }
.auth-link { margin-top: var(--cpy); }
.lock-tries { margin-bottom: var(--hg); }
.lock-hint { margin-top: var(--hg); }
.lock-link { padding: 0; border: 0; background: none; cursor: pointer; font-size: inherit; }
.lock-row { display: flex; justify-content: center; gap: var(--hg); flex-wrap: wrap; margin: var(--hg) 0; }
.lock-check { display: flex; align-items: center; gap: var(--hg); margin-bottom: var(--cpy); font-size: var(--fs-sm); }
.lock-user { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
</style>
