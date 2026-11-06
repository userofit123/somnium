<script setup lang="ts">
// The lock screen (PLAN.md §4.3): opaque, with nothing of the journal behind it (App.vue keeps the shells unmounted).
// A successful unwrap of the data key is the proof, so this works without a connection. After five wrong tries in a
// row each further try waits longer; nothing is ever deleted or signed out for it. Wrong tries are wrong passwords and
// device verifications that answer with the wrong thing: a cancelled verification or no connection never counts.
// While a wait runs, a try is refused before the password is looked at.
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { FREE_WRONG_TRIES, deviceFailureCounts, formatWait } from "@somnium/shared";
import { isLocalAccount, session, signOut, unsentChanges } from "../core/session";
import { keyOpenedOnLockScreen, lock, markUnlocked, whileVerifying, wrongTry, wrongTryWait } from "../core/lock";
import { keyring } from "../core/keyring";
import { cachedBundle, declineDevice, deviceStatus, deviceVerifierExists, freshBundle, setUpDevice, shouldOfferDevice, unlockWithDevice, unlockWithPassword, type UnlockBundle } from "../core/unlock";
import Logo from "./Logo.vue";

type Step = "loading" | "password" | "device" | "offer" | "noPrf" | "recovery" | "signOut" | "local";
const step = ref<Step>("loading");
const password = ref(""), err = ref(""), busy = ref(false);
const bundle = ref<UnlockBundle | null>(cachedBundle());
const canUseDevice = ref(false);
const pwInput = ref<HTMLInputElement | null>(null);
// the server's answer, when it comes, replaces the copy on this device; a try waits for it
let loaded: Promise<void> = Promise.resolve();

const sealed = computed(() => !!bundle.value && !bundle.value.wrappedByPassword);
const triesLeft = computed(() => FREE_WRONG_TRIES - lock.wrongTries);
const triesText = computed(() => (lock.wrongTries === 0 || triesLeft.value <= 0 ? "" : `${triesLeft.value} ${triesLeft.value === 1 ? "try" : "tries"} left, then each try has to wait.`));
const waiting = computed(() => lock.waitMs > 0);
const waitText = computed(() => `Too many wrong tries. Try again in ${formatWait(lock.waitMs)}. Your journal stays locked.`);
const unsent = computed(() => unsentChanges());

const showPassword = () => { step.value = "password"; err.value = ""; void nextTick(() => pwInput.value?.focus()); };

onMounted(async () => {
  if (await isLocalAccount()) { step.value = "local"; return; }
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

async function askSignOut() { if (unsent.value) { step.value = "signOut"; err.value = ""; } else await leave(); }
async function leave() {
  if (busy.value) return;
  busy.value = true;
  try { await signOut({ force: true }); } finally { busy.value = false; }
}
</script>

<template>
  <div class="auth lock-screen" role="dialog" aria-modal="true" aria-label="Somnium is locked">
    <div v-if="step === 'loading'" class="card"><Logo /><h1>Locked</h1></div>

    <!-- a local account has no password to ask for, and none is invented here: see docs/security.md -->
    <div v-else-if="step === 'local'" class="card">
      <Logo />
      <h1>Locked</h1>
      <p class="muted auth-lede">This account has no password, so this screen only hides your journal. It doesn't keep anyone out.</p>
      <button type="button" class="btn block lg" autofocus @click="markUnlocked()">Open</button>
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

    <div v-else-if="step === 'recovery'" class="card">
      <Logo />
      <h1>Recovery key</h1>
      <p class="muted auth-lede">Coming in the next update</p>
      <p class="center tiny auth-link"><button type="button" class="lock-link acc" @click="step = 'password'">Back</button></p>
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
      <p class="muted auth-lede">Your password was reset, so nothing here can open your dreams until your recovery key is entered.</p>
      <button type="button" class="btn block lg" @click="step = 'recovery'">Enter recovery key</button>
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
      <p class="muted auth-lede">@{{ session.user?.username }}</p>
      <!-- for password managers: which account this password is for -->
      <input class="lock-user" type="text" autocomplete="username" :value="session.user?.username" readonly tabindex="-1" aria-hidden="true" />
      <div class="fld"><label for="lock-pw">Password</label><input id="lock-pw" ref="pwInput" v-model="password" type="password" autocomplete="current-password" required /></div>
      <div v-if="waiting" class="err" role="status">{{ waitText }}</div>
      <div v-else-if="err" class="err" role="alert">{{ err }}</div>
      <p v-else-if="triesText" class="tiny lock-tries">{{ triesText }}</p>
      <button class="btn block lg" :disabled="busy || waiting">{{ busy ? "Unlocking..." : "Unlock" }}</button>
      <p v-if="canUseDevice" class="center tiny auth-link"><button type="button" class="lock-link acc" @click="step = 'device'; err = ''">Use this device instead</button></p>
      <p class="center tiny auth-link"><button type="button" class="lock-link muted" @click="askSignOut">Sign out</button></p>
    </form>
  </div>
</template>

<style scoped>
/* Opaque and above everything: nothing shows through, on any theme. */
.lock-screen { position: fixed; inset: 0; z-index: 1000; overflow-y: auto; background: var(--bg); padding-top: var(--st, 0px); padding-bottom: var(--sb, 0px); }
.auth-lede { margin-bottom: var(--cpy); font-size: var(--fs-sm); }
.auth-link { margin-top: var(--cpy); }
.lock-tries { margin-bottom: var(--hg); }
.lock-link { padding: 0; border: 0; background: none; cursor: pointer; font-size: inherit; }
.lock-user { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
</style>
