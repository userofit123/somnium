<script setup lang="ts">
// First screen of the Android app: use Somnium on this phone, or connect to a server. Saved accounts and servers to open.
// A server is checked and saved here; signing in to it comes next, on its own sign-in screen.
import { ref } from "vue";
import { accounts, addLocal, addServer, open, remove, rename } from "../native/accounts";
import { prompt } from "../core/ask";
import Logo from "./Logo.vue";
import Icon from "../components/Icon.vue";
import Menu from "../components/Menu.vue";

const mode = ref<"" | "local" | "server">("");
const name = ref("Me"), url = ref(""), label = ref(""), err = ref(""), busy = ref(false);
async function connect() {
  err.value = ""; busy.value = true;
  try { await addServer(url.value, label.value); } catch (e) { err.value = (e as Error).message; } finally { busy.value = false; }
}
async function renameAcc(id: string, cur: string) { const n = await prompt("Name", { value: cur }); if (n) rename(id, n); }
</script>

<template>
  <div class="auth" role="main">
    <div class="card">
      <Logo />
      <template v-if="!mode">
        <h1>Somnium</h1>
        <p class="muted" style="margin-bottom:18px">{{ accounts.list.length ? "Open an account, or add another." : "Choose how to use Somnium. You can add the other kind later." }}</p>
        <div class="opt-list">
          <div v-for="a in accounts.list" :key="a.id" class="row"><button class="optb" @click="open(a.id)"><span class="oi">{{ a.name.slice(0, 1).toUpperCase() }}</span><div class="grow"><div class="t">{{ a.name }}</div><div class="s">{{ a.kind === "local" ? "On this phone" : (a.user ? a.user + " · " : "") + a.url }}</div></div></button><Menu :items="[{ label: 'Rename', icon: 'edit', run: () => renameAcc(a.id, a.name) }, { label: 'Remove', icon: 'trash', danger: true, sep: true, run: () => remove(a.id) }]" /></div>
          <button class="optb" @click="mode = 'local'"><span class="oi"><Icon name="device" /></span><div class="grow"><div class="t">Use Somnium on this phone</div><div class="s">Everything stays here, sealed with a password you choose.</div></div></button>
          <button class="optb" @click="mode = 'server'"><span class="oi"><Icon name="server" /></span><div class="grow"><div class="t">Connect to a server</div><div class="s">Your data on your own Somnium server, the same on every device.</div></div></button>
        </div>
      </template>
      <template v-else-if="mode === 'local'">
        <h1>On this phone</h1>
        <div class="fld"><label>Your name</label><input aria-label="Your name" v-model="name" /></div>
        <button class="btn block lg" @click="addLocal(name)">Start</button>
        <button class="qb" style="margin:10px auto 0;display:flex" @click="mode = ''">Back</button>
      </template>
      <template v-else>
        <h1>Your server</h1>
        <div class="fld"><label>Address</label><input aria-label="Address" v-model="url" placeholder="somnium.example.com" autocapitalize="off" inputmode="url" /></div>
        <div class="fld"><label>Name (optional)</label><input aria-label="Name (optional)" v-model="label" placeholder="Home" /></div>
        <div v-if="err" class="err">{{ err }}</div>
        <button class="btn block lg" :disabled="busy || !url.trim()" @click="connect">Check and add</button>
        <button class="qb" style="margin:10px auto 0;display:flex" @click="mode = ''">Back</button>
      </template>
    </div>
  </div>
</template>
