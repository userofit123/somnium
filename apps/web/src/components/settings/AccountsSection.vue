<script setup lang="ts">
// Settings → Servers & accounts. In the desktop and Android apps: the servers and on-device accounts saved here, which
// one is open, opening another, adding and removing (like Money Manager's Settings → Server). In a browser the server is
// the site itself, so this only says which one it is and how to use another.
import { ref } from "vue";
import Icon from "../Icon.vue";
import Menu from "../Menu.vue";
import { prompt } from "../../core/ask";
import { toastError } from "../../core/toast";

const nat = (globalThis as any).somniumNative?.accounts;
const list = ref<{ id: string; kind: string; name: string; url?: string }[]>([]);
const active = ref<string | null>(null);
const busy = ref(false);
const host = location.host;
const load = () => nat?.list().then((a: any) => { list.value = a.list; active.value = a.active; });
load();
async function rename(id: string, cur: string) {
  const n = await prompt("Name", { value: cur });
  if (n) { await nat.rename(id, n); load(); }
}
// the app asks before removing; removing the open one goes back to the start screen, any other stays here
async function remove(id: string) { await nat.remove(id); load(); }
async function addServer() {
  const url = await prompt("Add a server", { placeholder: "somnium.example.com", ok: "Check and add", text: "The address of a Somnium server (https). It opens once it's checked, and you sign in to it there." });
  if (!url?.trim()) return;
  busy.value = true;
  // on success the app opens the new server, so nothing more happens on this page
  try { await nat.addServer(url, ""); } catch (e) { toastError(e); } finally { busy.value = false; }
}
async function addLocal() {
  const n = await prompt("Add an account on this device", { value: "Me", ok: "Add", text: "Everything stays on this device, nothing to set up. Your name:" });
  if (n !== null) await nat.addLocal(n.trim() || "Me");
}
</script>

<template>
  <div v-if="nat" class="stack">
    <div class="sh first"><h2>Saved on this device</h2><Menu :items="[{ label: 'Add an account on this device', icon: 'device', run: addLocal }]" /></div>
    <div class="card flush">
      <div v-for="a in list" :key="a.id" class="li">
        <Icon :name="a.kind === 'local' ? 'device' : 'server'" :size="18" class="muted" />
        <div class="grow"><div class="t">{{ a.name }}</div><div class="s">{{ a.kind === "local" ? "Everything on this device" : a.url }}</div></div>
        <span v-if="a.id === active" class="tiny acc">In use</span>
        <button v-else class="qb" @click="nat.open(a.id)">Open</button>
        <Menu :items="[{ label: 'Rename', icon: 'edit', run: () => rename(a.id, a.name) }, { label: 'Remove', icon: 'trash', danger: true, sep: true, run: () => remove(a.id) }]" />
      </div>
    </div>
    <button class="btn" :disabled="busy" @click="addServer"><Icon name="plus" :size="16" />{{ busy ? "Checking…" : "Add a server" }}</button>
    <p class="tiny">Open switches the whole app to that server or account. A server account shows the data on that Somnium server; a local account keeps everything on this device. Each keeps its own copy here, so switching never mixes them.</p>
  </div>
  <div v-else class="stack">
    <div class="card flush"><div class="li"><Icon name="server" :size="18" class="muted" /><div class="grow"><div class="t">This Somnium server</div><div class="s">{{ host }}</div></div><span class="tiny acc">In use</span></div></div>
    <p class="tiny">In a browser, Somnium is the site whose address you opened, so there's nothing to switch here. To use another server, open its address. The Android and desktop apps can keep several servers and switch between them.</p>
  </div>
</template>
