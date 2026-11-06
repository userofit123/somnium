<script setup lang="ts">
// Settings → Servers & accounts (PLAN.md §2, §6.7). In the desktop and Android apps: the accounts on this device and the
// saved servers, each with the name given to it, its address, the accounts on it and how their sync is going; adding,
// renaming, moving and removing them, and switching (Money Manager's Settings → Server, Motus's accounts).
// In a browser, Somnium is the site the page came from: it shows that server only (see the note at the bottom).
import { computed, onMounted, ref } from "vue";
import { checkServerAddress, orderAccounts, removePlan, type AccountEntry, type ServerEntry } from "@somnium/shared";
import Icon from "../Icon.vue";
import Menu from "../Menu.vue";
import { confirm, prompt } from "../../core/ask";
import { toastError } from "../../core/toast";
import { session, unsentChanges } from "../../core/session";
import { saved, refreshAccounts, nativeAccounts, deviceWord, labelFor, switchTo, closeCurrent, webServerName, renameWebServer, currentSyncLabel } from "../../core/accounts";

const nat = nativeAccounts();
const dev = deviceWord();
const ordered = computed(() => orderAccounts(saved));
onMounted(refreshAccounts);

const adding = ref(false), name = ref(""), url = ref(""), err = ref(""), busy = ref(false);
const check = computed(() => (url.value.trim() ? checkServerAddress(url.value) : null));
// the warning shows as the address is typed; the app that can't use http says so before anything is sent
const warn = computed((): string => (check.value?.ok && check.value.insecure ? (nat?.insecureAllowed ? check.value.warning ?? "" : "This app only connects over https. Use the https address of your server.") : ""));
async function addServer() {
  err.value = "";
  const c = checkServerAddress(url.value);
  if (!c.ok) { err.value = c.error; return; }
  if (c.insecure && !nat?.insecureAllowed) { err.value = warn.value; return; }
  busy.value = true;
  // on success the app opens the new server's sign-in screen, so this account closes first
  try { await nat!.addServer(c.origin, name.value); } catch (e) { err.value = (e as Error).message; } finally { busy.value = false; }
}
async function run(f: () => Promise<unknown>) { try { await f(); } catch (e) { toastError(e); } await refreshAccounts(); }

async function addLocal() {
  const n = await prompt(`Add an account on this ${dev}`, { value: "Me", ok: "Add", text: `Everything stays on this ${dev}, sealed with a password you choose next. Its name:` });
  if (n === null) return;
  await closeCurrent();
  await run(() => nat!.addLocal(n.trim() || "Me"));
}
async function renameAccount(a: AccountEntry) { const n = await prompt("Name", { value: a.name }); if (n?.trim()) await run(() => nat!.rename(a.id, n)); }
async function renameServer(s: ServerEntry) { const n = await prompt("Server name", { value: s.name, text: "Only on this " + dev + ", to tell your servers apart." }); if (n?.trim()) await run(() => nat!.renameServer(s.id, n)); }
async function moveServer(s: ServerEntry) {
  const u = await prompt("Server address", { value: s.url, ok: "Check and save", text: "Where this server is now. It is checked before it's saved; the accounts on it follow it." });
  if (!u?.trim()) return;
  const c = checkServerAddress(u);
  if (!c.ok) return toastError(new Error(c.error));
  if (c.insecure && !(nat?.insecureAllowed && (await confirm("Use an unencrypted address?", { text: c.warning, ok: "Use it" })))) return;
  const pend = pendingOn(s.id);
  if (pend && !(await confirm(`${pend} change${pend === 1 ? " hasn't" : "s haven't"} reached this server yet`, { text: "Its copy on this " + dev + " was kept for the old address. Moving now may lose them; open the account at the old address first to send them.", ok: "Move anyway", danger: true }))) return;
  const open = saved.list.some((a) => a.serverId === s.id && a.id === saved.active);
  if (open) await closeCurrent();
  await run(() => nat!.setServerAddress(s.id, c.origin));
}
const pendingOf = (a: AccountEntry) => (a.id === saved.active ? (session.user ? unsentChanges() : 0) : a.sync?.pending ?? 0);
const pendingOn = (serverId: string) => saved.list.filter((a) => a.serverId === serverId).reduce((n, a) => n + pendingOf(a), 0);
const who = (a: AccountEntry) => (a.kind === "local" ? a.name : a.user || "Not signed in");

// removing asks once, naming what goes; with changes not on the server yet it asks again, plainly
async function guarded(p: ReturnType<typeof removePlan>) {
  if (!(await confirm(p.title, { ok: p.ok, danger: true, text: p.text }))) return false;
  return !p.unsent || confirm(`${p.unsent} change${p.unsent === 1 ? " is" : "s are"} not on the server yet`, { ok: "Remove anyway", danger: true, text: `They exist only on this ${dev} and are lost if you remove it now. Keep it until the server can be reached and they are sent.` });
}
async function removeAccount(a: AccountEntry) {
  if (!(await guarded(removePlan({ what: "account", name: who(a), kind: a.kind, pending: pendingOf(a), device: dev })))) return;
  if (a.id === saved.active) await closeCurrent();
  await run(() => nat!.removeAccount(a.id));
}
async function removeServer(s: ServerEntry, n: number) {
  if (!(await guarded(removePlan({ what: "server", name: s.name, kind: "server", pending: pendingOn(s.id), accounts: n, device: dev })))) return;
  if (saved.list.some((a) => a.serverId === s.id && a.id === saved.active)) await closeCurrent();
  await run(() => nat!.removeServer(s.id));
}
async function addAccount(s: ServerEntry) { await closeCurrent(); await run(() => nat!.addAccount(s.id)); }
const insecure = (u: string) => u.startsWith("http://");

// a browser
async function renameWeb() { const n = await prompt("Server name", { value: webServerName.value, text: "Only in this browser, to tell your servers apart." }); if (n?.trim()) renameWebServer(n); }
const host = location.host;
</script>

<template>
  <div v-if="nat" class="stack">
    <div class="sh first"><h2>This {{ dev }}</h2><Menu :items="[{ label: `Add an account on this ${dev}`, icon: 'device', run: addLocal }]" /></div>
    <div class="card flush">
      <div v-for="a in ordered.device" :key="a.id" class="li">
        <Icon name="device" :size="18" class="muted" />
        <div class="grow"><div class="t">{{ a.name }}</div><div class="s">Everything on this {{ dev }}</div></div>
        <span v-if="a.id === saved.active" class="tiny acc">In use</span>
        <button v-else class="qb" @click="switchTo(a.id)">Switch</button>
        <Menu :items="[{ label: 'Rename', icon: 'edit', run: () => renameAccount(a) }, { label: 'Remove', icon: 'trash', danger: true, sep: true, run: () => removeAccount(a) }]" />
      </div>
      <div v-if="!ordered.device.length" class="li"><div class="grow"><div class="s">No account on this {{ dev }}. Add one to keep a journal here with no server at all.</div></div><button class="qb acc" @click="addLocal">Add</button></div>
    </div>

    <template v-for="g in ordered.servers" :key="g.server.id">
      <div class="sh">
        <div class="grow"><h2>{{ g.server.name }}</h2><div class="tiny">{{ g.server.url }}<template v-if="insecure(g.server.url)"> · not encrypted</template></div></div>
        <Menu :items="[
          { label: 'Rename server', icon: 'edit', run: () => renameServer(g.server) },
          { label: 'Change address', icon: 'link', run: () => moveServer(g.server) },
          { label: 'Add an account', hint: 'Sign in as someone else on it', icon: 'user', run: () => addAccount(g.server) },
          { label: 'Remove server', icon: 'trash', danger: true, sep: true, run: () => removeServer(g.server, g.accounts.length) },
        ]" />
      </div>
      <div class="card flush">
        <div v-for="a in g.accounts" :key="a.id" class="li">
          <Icon name="user" :size="18" class="muted" />
          <div class="grow"><div class="t">{{ who(a) }}</div><div class="s">{{ labelFor(a) }}</div></div>
          <span v-if="a.id === saved.active" class="tiny acc">In use</span>
          <button v-else class="qb" @click="switchTo(a.id)">Switch</button>
          <Menu :items="[{ label: 'Remove account', icon: 'trash', danger: true, run: () => removeAccount(a) }]" />
        </div>
        <div v-if="!g.accounts.length" class="li"><div class="grow"><div class="s">No account on this server yet</div></div><button class="qb acc" @click="addAccount(g.server)">Sign in</button></div>
      </div>
    </template>

    <div v-if="adding" class="card">
      <div class="fld"><label for="srv-name">Name</label><input id="srv-name" v-model="name" placeholder="Home" maxlength="60" /></div>
      <div class="fld"><label for="srv-url">Address</label><input id="srv-url" v-model="url" placeholder="somnium.example.com" autocapitalize="off" autocomplete="off" spellcheck="false" inputmode="url" @keydown.enter="addServer" /></div>
      <p v-if="warn" class="tiny" role="note"><Icon name="info" :size="14" /> {{ warn }}</p>
      <div v-if="err" class="err" role="alert">{{ err }}</div>
      <div class="row"><button class="btn" :disabled="busy || !url.trim()" @click="addServer">{{ busy ? "Checking…" : "Check and add" }}</button><button class="qb" @click="adding = false; err = ''">Cancel</button></div>
    </div>
    <button v-else class="btn" @click="adding = true"><Icon name="plus" :size="16" />Add a server</button>
    <p class="tiny">Switch locks the open account and opens the other on its own lock screen. Each account keeps its own copy, drafts and unsent changes on this {{ dev }}, so switching never mixes them. Names and addresses are kept on this {{ dev }} only.</p>
  </div>
  <div v-else class="stack">
    <div class="sh first"><h2>This server</h2><Menu :items="[{ label: 'Rename', icon: 'edit', run: renameWeb }]" /></div>
    <div class="card flush">
      <div class="li"><Icon name="server" :size="18" class="muted" /><div class="grow"><div class="t">{{ webServerName }}</div><div class="s">{{ host }}</div></div><span class="tiny acc">In use</span></div>
      <div v-if="session.user" class="li"><Icon name="user" :size="18" class="muted" /><div class="grow"><div class="t">{{ session.user.username }}</div><div class="s">{{ currentSyncLabel() }}</div></div></div>
    </div>
    <p class="tiny">In a browser, Somnium is the site whose address you opened, and it only talks to that server: a page from one server can't safely hold your sign-in and journal for another. To use another server, open its address, or use the desktop or Android app, which keep several servers and accounts on this device side by side and switch between them.</p>
  </div>
</template>
