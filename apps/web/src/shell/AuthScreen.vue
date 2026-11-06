<script setup lang="ts">
// Sign in, create the first (admin) account, or join with an invite. The password stays on this device: Argon2id
// turns it into authKey (sent) and encKey (opens the journal's data key from the envelope the server hands back,
// PLAN.md §4.1). With two-factor on, the server asks for a code before it answers. "Forgot password?" takes a reset
// code from the admin (§4.4): a new password, with the journal sealed until a recovery key or signed-in device opens it.
import { ref, computed } from "vue";
import { createAccountKeys, openWithEncKey, passwordProblem, PASSWORD_MIN } from "@somnium/shared";
import { api } from "../api/client";
import { session, loadSession } from "../core/session";
import { deviceId } from "../core/prefs";
import { keyring } from "../core/keyring";
import { keysFor, type SignInKeys } from "../core/auth";
import Logo from "./Logo.vue";
import { current, setToken } from "../native/accounts";

// in the desktop and Android apps: back to the list of accounts and servers on this device
const accounts = (globalThis as any).somniumNative?.accounts;

const mode = ref<"login" | "register">("login");
const f = ref({ username: "", password: "", displayName: "", invite: new URLSearchParams(location.search).get("invite") ?? "" });
if (f.value.invite) mode.value = "register";
// after the password: the second factor. backup = the code field takes a one-time backup code instead
const step = ref<"form" | "code" | "forgot" | "reset" | "recovery" | "resetDone">("form");
const code = ref(""), backup = ref(false);
const err = ref(""), busy = ref<"" | "unlock" | "send">("");
// the reset code form, and what comes back: the sentence to show, and the sign-in to finish when it has been read
const reset = ref({ code: "", password: "" });
const resetMessage = ref("");
let resetSignIn: unknown = null;
const setup = computed(() => session.setupNeeded);
const creating = computed(() => setup.value || mode.value === "register");
let keys: SignInKeys | null = null; // kept between the password step and the code step, so Argon2id runs once

// the Android app signs in to its server with a token (it isn't on the server's own address, so no cookie)
const app = current()?.kind === "server";
const device = () => ({ deviceId: deviceId(), deviceName: app ? "Android app" : navigator.userAgent.includes("Android") ? "Android browser" : "Browser", ...(app ? { wantToken: true, platform: "android" } : {}) });

async function finish(r: any, encKey: Uint8Array | null, dataKey?: Uint8Array) {
  if (app && r?.token) setToken(r.token);
  // the server keeps the data key only wrapped by the password: open it here, never there
  if (dataKey) keyring.set(dataKey);
  else if (encKey && r?.wrappedByPassword) keyring.set(await openWithEncKey({ salt: r.kdfSalt, wrappedByPassword: r.wrappedByPassword }, encKey));
  else keyring.clear(); // after an admin reset: signed in, journal sealed until the recovery key or a signed-in device re-wraps it (LDJ-7)
  keys = null; f.value.password = ""; code.value = "";
  await loadSession();
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
      busy.value = "send";
      const r = await api.post("/auth/sign-up", { username, displayName: f.value.displayName, invite: f.value.invite, authKey: made.authKey, kdfSalt: made.salt, wrappedByPassword: made.wrappedByPassword, ...device() });
      await finish(r, null, made.dataKey);
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
function back() { step.value = "form"; code.value = ""; err.value = ""; keys = null; }

// A new password from a reset code. Only the new authKey and salt are sent: the journal's data key is lost to this
// device until a recovery key or a signed-in device brings it back, so the fresh one made alongside is never used.
async function sendReset() {
  err.value = "";
  try {
    const username = f.value.username.trim().toLowerCase();
    const problem = await passwordProblem(reset.value.password);
    if (problem) { err.value = problem; return; }
    busy.value = "unlock";
    const made = await createAccountKeys(reset.value.password);
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
  <div class="auth">
    <form v-if="step === 'code'" class="card" @submit.prevent="go">
      <Logo />
      <h1>One more step</h1>
      <p class="muted auth-lede">{{ backup ? "Type one of your backup codes. It works once." : "Type the code from your authenticator app." }}</p>
      <div class="fld"><label>{{ backup ? "Backup code" : "6-digit code" }}</label><input v-model="code" :inputmode="backup ? 'text' : 'numeric'" :maxlength="backup ? 11 : 6" autocomplete="one-time-code" autocapitalize="characters" autofocus required /></div>
      <div v-if="err" class="err">{{ err }}</div>
      <button class="btn block lg" :disabled="!!busy">{{ busy ? "Signing in..." : "Sign in" }}</button>
      <p class="center tiny auth-link"><a class="acc click" @click="backup = !backup; code = ''">{{ backup ? "Use the authenticator app instead" : "Lost the authenticator? Use a backup code" }}</a></p>
      <p class="center tiny auth-link"><a class="acc click" @click="back">Back</a></p>
    </form>
    <div v-else-if="step === 'forgot'" class="card">
      <Logo />
      <h1>Forgot password?</h1>
      <p class="muted auth-lede">What do you have?</p>
      <div class="auth-choices">
        <button type="button" class="btn o block" @click="step = 'reset'; err = ''">I have a reset code</button>
        <button type="button" class="btn o block" @click="step = 'recovery'; err = ''">I have a recovery key</button>
      </div>
      <p class="center tiny auth-link"><a class="acc click" @click="back">Back</a></p>
    </div>
    <div v-else-if="step === 'recovery'" class="card">
      <Logo />
      <h1>Recovery key</h1>
      <p class="muted auth-lede">Coming in the next update</p>
      <p class="center tiny auth-link"><a class="acc click" @click="step = 'forgot'">Back</a></p>
    </div>
    <form v-else-if="step === 'reset'" class="card" @submit.prevent="sendReset">
      <Logo />
      <h1>Set a new password</h1>
      <p class="muted auth-lede">Your admin can give you a reset code. It works once, for one day.</p>
      <div class="fld"><label>Username</label><input v-model="f.username" autocomplete="username" autocapitalize="off" required /></div>
      <div class="fld"><label>Reset code</label><input v-model="reset.code" maxlength="11" autocomplete="off" autocapitalize="characters" required /></div>
      <div class="fld"><label>New password</label><input v-model="reset.password" type="password" autocomplete="new-password" required :minlength="PASSWORD_MIN" /><p class="tiny auth-hint">At least {{ PASSWORD_MIN }} characters.</p></div>
      <div v-if="err" class="err">{{ err }}</div>
      <button class="btn block lg" :disabled="!!busy">{{ busy ? "Setting your password..." : "Set password" }}</button>
      <p class="center tiny auth-link"><a class="acc click" @click="step = 'forgot'; err = ''">Back</a></p>
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
      <div class="fld"><label>Username</label><input v-model="f.username" autocomplete="username" autocapitalize="off" required /></div>
      <div class="fld"><label>Password</label><input v-model="f.password" type="password" :autocomplete="creating ? 'new-password' : 'current-password'" required :minlength="creating ? PASSWORD_MIN : undefined" />
        <p v-if="creating" class="tiny auth-hint">At least {{ PASSWORD_MIN }} characters. It seals your journal: the server never sees it, so nobody can send it to you if it is lost - you will get a recovery key.</p></div>
      <div v-if="!setup && mode === 'register' && session.registration === 'invite'" class="fld"><label>Invite code</label><input v-model="f.invite" required /></div>
      <div v-if="err" class="err">{{ err }}</div>
      <button class="btn block lg" :disabled="!!busy">{{ busy === "unlock" ? "Unlocking..." : busy ? (creating ? "Creating..." : "Signing in...") : creating ? "Create account" : "Sign in" }}</button>
      <p v-if="!setup && mode === 'login'" class="center tiny auth-link"><a class="acc click" @click="step = 'forgot'; err = ''">Forgot password?</a></p>
      <p v-if="!setup && session.registration !== 'closed'" class="center tiny auth-link">
        <a v-if="mode === 'login'" class="acc click" @click="mode = 'register'; err = ''">Have an invite? Create an account</a>
        <a v-else class="acc click" @click="mode = 'login'; err = ''">Already have an account? Sign in</a>
      </p>
      <p v-if="accounts" class="center tiny auth-link"><a class="acc click" @click="accounts.chooser()">Other accounts and servers</a></p>
    </form>
  </div>
</template>

<style scoped>
.auth-lede { margin-bottom: var(--cpy); font-size: var(--fs-sm); }
.auth-link { margin-top: var(--cpy); }
.auth-hint { margin-top: var(--hg); }
.auth-choices { display: flex; flex-direction: column; gap: var(--hg); }
</style>
