<script setup lang="ts">
// Settings → Account: who you are (name, username and role), signing out, sync, every other place this account is
// signed in, and deleting it. The password is changed under Security, with everything else about getting in (LDJ-144).
// No email (LDJ-145): the server sends no mail, so asking for one would only collect personal data for nothing.
// A local account (no server) has no username to show and no other devices: those rows are left out.
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { useQuery } from "@tanstack/vue-query";
import { useMe } from "../../api/queries";
import { api } from "../../api/client";
import { invalidate } from "../../api/live";
import { sync, schedule } from "../../api/replica";
import { signOut, isLocalAccount } from "../../core/session";
import { authKeyFor } from "../../core/auth";
import { prompt } from "../../core/ask";
import { toast, toastError, savedToast, savedError } from "../../core/toast";
import { useFmt, ago } from "../../core/format";
import Icon from "../Icon.vue";
import QueryState from "../QueryState.vue";

const router = useRouter();
const me = useMe();
const fmt = useFmt();
const user = computed(() => me.data.value?.user);
const initials = computed(() => (user.value?.displayName || user.value?.username || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join(""));
// null until we know: the account-specific rows and the sessions query wait for it, so a local account never flashes the server-only parts
const localAccount = ref<boolean | null>(null);
isLocalAccount().then((v) => { localAccount.value = v; });

const val = (e: Event) => (e.target as HTMLInputElement).value.trim();
async function saveName(displayName: string) {
  if (displayName === user.value?.displayName) return;
  try { await api.put("/me", { displayName }); invalidate(["settings"]); savedToast(); } catch (e) { savedError(e); }
}

// every place this account is signed in; API tokens are listed under Integrations, not here
const sessions = useQuery({ queryKey: ["settings", "sessions"], queryFn: () => api.get("/auth/sessions"), enabled: computed(() => localAccount.value === false) });
// holdsKey: that sign-in keeps the journal's key behind its own screen lock (LDJ-10), so it can set a new password
type Session = { id: string; deviceName?: string; platform?: string; current?: boolean; lastSeenAt?: string; createdAt?: string; holdsKey?: boolean };
const devices = computed(() => ((sessions.data.value ?? []) as Session[]).filter((x) => x.platform !== "api").sort((a, b) => Number(b.current) - Number(a.current)));
const others = computed(() => devices.value.filter((x) => !x.current).length);
const icon = (x: Session) => (x.platform === "android" || /Android|iPhone/.test(x.deviceName ?? "") ? "device" : "server");
async function endSession(id: string) { try { await api.del(`/auth/sessions/${id}`); sessions.refetch(); toast("Signed out that device"); } catch (e) { toastError(e); } }
async function endOthers() { try { await api.post("/auth/logout-others"); sessions.refetch(); toast("Signed out everywhere else"); } catch (e) { toastError(e); } }

// straight to the server, never queued: without a connection it fails and nothing is deleted.
// A wrong password leaves you signed in; ask again.
async function deleteAccount() {
  const password = await prompt("Delete your account?", { text: "Everything you have in Somnium is deleted for good. Download a backup first if you might want it. Type your password to confirm.", placeholder: "Password", ok: "Delete account", secret: true, danger: true });
  if (!password) return;
  try { await api.del("/auth/account", { authKey: await authKeyFor(user.value!.username, password) }); await signOut(); } catch (e) { toastError(e); }
}
</script>

<template>
  <div class="card ac-head">
    <div class="ac-av" aria-hidden="true">{{ initials }}</div>
    <div class="grow ac-who">
      <div class="ac-name">{{ user?.displayName || user?.username }}</div>
      <div v-if="localAccount === false" class="tiny">@{{ user?.username }} · {{ user?.role === "admin" ? "admin" : "member" }}</div>
      <div v-else-if="localAccount" class="tiny">On this device only</div>
    </div>
  </div>

  <!-- flush cards: rows run edge to edge, so a tapped row lights up the full width like every other list -->
  <div class="card flush">
    <div class="li"><div class="grow t">Name</div><input class="ac-in" :value="user?.displayName ?? ''" placeholder="Your name" autocomplete="name" @change="saveName(val($event))" /></div>
    <div class="li"><div class="grow"><div class="t">Sign out</div><div class="s">From this device</div></div><button class="qb" @click="signOut()">Sign out</button></div>
  </div>

  <div v-if="sync.on" class="card"><div class="li"><Icon name="refresh" :size="18" class="muted" /><div class="grow"><div class="t">Works offline</div>
    <div class="s">{{ !sync.online ? "Can't reach the server: changes are saved on this device" : sync.syncing ? "Syncing…" : sync.lastAt ? `In sync · ${ago(new Date(sync.lastAt).toISOString())}` : "Getting ready" }}{{ sync.waiting ? ` · ${sync.waiting} waiting to be sent` : "" }}{{ sync.error ? ` · ${sync.error}` : "" }}</div></div>
    <button class="qb" :disabled="sync.syncing" @click="schedule(0)">Sync now</button></div></div>

  <template v-if="localAccount === false">
    <div class="sh"><h2>Signed-in devices</h2><button v-if="others" class="lnk" @click="endOthers">Sign out the others</button></div>
    <p class="tiny hgap">{{ !sessions.data.value ? "" : others ? `This account is also signed in on ${others} other device${others === 1 ? "" : "s"}. Sign out any you don't know.` : "This account isn't signed in anywhere else." }}</p>
    <QueryState v-if="sessions.isLoading.value || sessions.isError.value" :q="sessions" what="your devices" sm />
    <div v-else class="card flush">
      <div v-for="x in devices" :key="x.id" class="li"><Icon :name="icon(x)" :size="18" class="muted" />
        <div class="grow"><div class="t">{{ x.deviceName || x.platform }}</div>
          <div class="s">{{ (x.current ? "This device · active now" : `Last active ${ago(x.lastSeenAt)} · signed in ${fmt.date(x.createdAt, { day: "numeric", month: "short", year: "numeric" })}`) + (x.holdsKey ? " · holds your key" : "") }}</div></div>
        <button v-if="!x.current" class="qb" @click="endSession(x.id)">Sign out</button></div>
    </div>
  </template>

  <div v-if="localAccount === true" class="card"><div class="li"><div class="grow"><div class="t">Delete account</div><div class="s">This account is only on this device. Remove it under Servers & accounts.</div></div><button class="qb" @click="router.push('/settings/accounts')">Open</button></div></div>
  <div v-else-if="localAccount === false" class="card"><div class="li"><div class="grow"><div class="t ac-neg">Delete account</div><div class="s">Deletes everything you have in Somnium</div></div><button class="qb danger" @click="deleteAccount">Delete</button></div></div>
</template>

<style scoped>
.ac-head { display: flex; align-items: center; gap: var(--spg); }
.ac-av { width: 56px; height: 56px; border-radius: 50%; flex: none; display: grid; place-items: center; background: var(--accc); color: var(--onc); font-size: calc(20px * var(--fsc)); font-weight: 700; letter-spacing: .02em; }
.ac-who { min-width: 0; }
.ac-who .tiny { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ac-name { font-size: calc(18px * var(--fsc)); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* the control column: same width on every input row so the card reads as one aligned form */
.li > .ac-in { width: min(240px, 58%); max-width: none; flex: none; }
.ac-neg { color: var(--neg); }
</style>
