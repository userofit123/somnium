<script setup lang="ts">
// Sign in, create the first (admin) account, or join with an invite.
import { ref, computed } from "vue";
import { api } from "../api/client";
import { session, loadSession } from "../core/session";
import Logo from "./Logo.vue";
import { current, setToken } from "../native/accounts";

// in the desktop and Android apps: back to the list of accounts and servers on this device
const accounts = (globalThis as any).somniumNative?.accounts;

const mode = ref<"login" | "register">("login");
const f = ref({ username: "", password: "", displayName: "", invite: new URLSearchParams(location.search).get("invite") ?? "" });
if (f.value.invite) mode.value = "register";
const err = ref(""), busy = ref(false);
const setup = computed(() => session.setupNeeded);
async function go() {
  err.value = ""; busy.value = true;
  try {
    const path = setup.value ? "/auth/setup" : mode.value === "login" ? "/auth/login" : "/auth/register";
    // the Android app signs in to its server with a token (it isn't on the server's own address, so no cookie)
    const app = current()?.kind === "server";
    const r = await api.post(path, { ...f.value, deviceName: app ? "Android app" : navigator.userAgent.includes("Android") ? "Android browser" : "Browser", ...(app ? { wantToken: true, platform: "android" } : {}) });
    if (app && r?.token) setToken(r.token);
    await loadSession();
  } catch (e) { err.value = (e as Error).message; } finally { busy.value = false; }
}
</script>

<template>
  <div class="auth">
    <form class="card" @submit.prevent="go">
      <Logo />
      <h1>{{ setup ? "Welcome to Somnium" : mode === "login" ? "Sign in" : "Create your account" }}</h1>
      <p class="muted" style="margin-bottom:20px;font-size:13.5px">{{ setup ? "Create the first account. It will be the admin of this server." : mode === "login" ? "Your dreams, sealed." : "You need an invite code from the admin." }}</p>
      <div v-if="setup || mode === 'register'" class="fld"><label>Your name</label><input v-model="f.displayName" autocomplete="name" /></div>
      <div class="fld"><label>Username</label><input v-model="f.username" autocomplete="username" autocapitalize="off" required /></div>
      <div class="fld"><label>Password</label><input v-model="f.password" type="password" :autocomplete="mode === 'login' && !setup ? 'current-password' : 'new-password'" required minlength="8" /></div>
      <div v-if="!setup && mode === 'register' && session.registration === 'invite'" class="fld"><label>Invite code</label><input v-model="f.invite" required /></div>
      <div v-if="err" class="err">{{ err }}</div>
      <button class="btn block lg" :disabled="busy">{{ setup ? "Create account" : mode === "login" ? "Sign in" : "Create account" }}</button>
      <p v-if="!setup && session.registration !== 'closed'" class="center tiny" style="margin-top:16px">
        <a v-if="mode === 'login'" class="acc click" @click="mode = 'register'">Have an invite? Create an account</a>
        <a v-else class="acc click" @click="mode = 'login'">Already have an account? Sign in</a>
      </p>
      <p v-if="accounts" class="center tiny" style="margin-top:12px"><a class="acc click" @click="accounts.chooser()">Other accounts and servers</a></p>
    </form>
  </div>
</template>
