<script setup lang="ts">
// Sign in, create the first (admin) account, or join with an invite. The password stays on this device: Argon2id
// turns it into authKey (sent) and encKey (opens the journal's data key from the envelope the server hands back,
// PLAN.md §4.1). With two-factor on, the server asks for a code before it answers.
import { ref, computed } from "vue";
import { createAccountKeys, openWithEncKey, passwordProblem, PASSWORD_MIN } from "@somnium/shared";
import { api } from "../api/client";
import { session, loadSession } from "../core/session";
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
const step = ref<"form" | "code">("form");
const code = ref(""), backup = ref(false);
const err = ref(""), busy = ref<"" | "unlock" | "send">("");
const forgot = ref(false);
const setup = computed(() => session.setupNeeded);
const creating = computed(() => setup.value || mode.value === "register");
let keys: SignInKeys | null = null; // kept between the password step and the code step, so Argon2id runs once

// the Android app signs in to its server with a token (it isn't on the server's own address, so no cookie)
const app = current()?.kind === "server";
const device = () => ({ deviceName: app ? "Android app" : navigator.userAgent.includes("Android") ? "Android browser" : "Browser", ...(app ? { wantToken: true, platform: "android" } : {}) });

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
</script>

<template>
  <div class="auth">
    <form v-if="step === 'code'" class="card" @submit.prevent="go">
      <Logo />
      <h1>One more step</h1>
      <p class="muted" style="margin-bottom:20px;font-size:13.5px">{{ backup ? "Type one of your backup codes. It works once." : "Type the code from your authenticator app." }}</p>
      <div class="fld"><label>{{ backup ? "Backup code" : "6-digit code" }}</label><input v-model="code" :inputmode="backup ? 'text' : 'numeric'" :maxlength="backup ? 11 : 6" autocomplete="one-time-code" autocapitalize="characters" autofocus required /></div>
      <div v-if="err" class="err">{{ err }}</div>
      <button class="btn block lg" :disabled="!!busy">{{ busy ? "Signing in..." : "Sign in" }}</button>
      <p class="center tiny" style="margin-top:16px"><a class="acc click" @click="backup = !backup; code = ''">{{ backup ? "Use the authenticator app instead" : "Lost the authenticator? Use a backup code" }}</a></p>
      <p class="center tiny" style="margin-top:12px"><a class="acc click" @click="back">Back</a></p>
    </form>
    <form v-else class="card" @submit.prevent="go">
      <Logo />
      <h1>{{ setup ? "Welcome to Somnium" : mode === "login" ? "Sign in" : "Create your account" }}</h1>
      <p class="muted" style="margin-bottom:20px;font-size:13.5px">{{ setup ? "Create the first account. It will be the admin of this server." : mode === "login" ? "Your dreams, sealed." : "You need an invite code from the admin." }}</p>
      <div v-if="creating" class="fld"><label>Your name</label><input v-model="f.displayName" autocomplete="name" /></div>
      <div class="fld"><label>Username</label><input v-model="f.username" autocomplete="username" autocapitalize="off" required /></div>
      <div class="fld"><label>Password</label><input v-model="f.password" type="password" :autocomplete="creating ? 'new-password' : 'current-password'" required :minlength="creating ? PASSWORD_MIN : undefined" />
        <p v-if="creating" class="tiny" style="margin-top:6px">At least {{ PASSWORD_MIN }} characters. It seals your journal: the server never sees it, so nobody can send it to you if it is lost - you will get a recovery key.</p></div>
      <div v-if="!setup && mode === 'register' && session.registration === 'invite'" class="fld"><label>Invite code</label><input v-model="f.invite" required /></div>
      <div v-if="err" class="err">{{ err }}</div>
      <button class="btn block lg" :disabled="!!busy">{{ busy === "unlock" ? "Unlocking..." : busy ? (creating ? "Creating..." : "Signing in...") : creating ? "Create account" : "Sign in" }}</button>
      <p v-if="!setup && mode === 'login'" class="center tiny" style="margin-top:16px"><a class="acc click" @click="forgot = !forgot">Forgot password?</a></p>
      <p v-if="forgot && mode === 'login'" class="tiny center" style="margin-top:8px">Soon: get back in with your recovery key, or with a reset code from the admin. Until then, a device that is still signed in can set a new password under Settings → Security.</p>
      <p v-if="!setup && session.registration !== 'closed'" class="center tiny" style="margin-top:12px">
        <a v-if="mode === 'login'" class="acc click" @click="mode = 'register'; err = ''">Have an invite? Create an account</a>
        <a v-else class="acc click" @click="mode = 'login'; err = ''">Already have an account? Sign in</a>
      </p>
      <p v-if="accounts" class="center tiny" style="margin-top:12px"><a class="acc click" @click="accounts.chooser()">Other accounts and servers</a></p>
    </form>
  </div>
</template>
