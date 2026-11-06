<script setup lang="ts">
// Settings → Account: everything about your account in one place. Who you are (name, optional email), username and role,
// password, signing out, sync, every other place this account is signed in, and deleting it.
// A local account (no server) has no password, no username to show and no other devices: those rows are left out.
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { useQuery } from "@tanstack/vue-query";
import { useMe } from "../../api/queries";
import { api } from "../../api/client";
import { invalidate } from "../../api/live";
import { sync, schedule } from "../../api/replica";
import { signOut, isLocalAccount } from "../../core/session";
import { keyring } from "../../core/keyring";
import { rememberBundle } from "../../core/unlock";
import { authKeyFor, keysFor } from "../../core/auth";
import { changePassword as rewrap, passwordProblem, PASSWORD_MIN } from "@somnium/shared";
import { prompt } from "../../core/ask";
import { toast, toastError, savedToast, savedError } from "../../core/toast";
import { useFmt, ago } from "../../core/format";
import Icon from "../Icon.vue";

const router = useRouter();
const me = useMe();
const fmt = useFmt();
const user = computed(() => me.data.value?.user);
const initials = computed(() => (user.value?.displayName || user.value?.username || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join(""));
// null until we know: the account-specific rows and the sessions query wait for it, so a local account never flashes the server-only parts
const localAccount = ref<boolean | null>(null);
isLocalAccount().then((v) => { localAccount.value = v; });

const val = (e: Event) => (e.target as HTMLInputElement).value.trim();
async function saveMe(patch: { displayName?: string; email?: string }) {
  const u = user.value;
  if ((patch.displayName ?? u?.displayName) === u?.displayName && (patch.email ?? u?.email ?? "") === (u?.email ?? "")) return;
  try { await api.put("/me", { displayName: patch.displayName ?? u?.displayName, email: patch.email ?? u?.email }); invalidate(["settings"]); savedToast(); } catch (e) { savedError(e); }
}

// every place this account is signed in; API tokens are listed under Integrations, not here
const sessions = useQuery({ queryKey: ["settings", "sessions"], queryFn: () => api.get("/auth/sessions"), enabled: computed(() => localAccount.value === false) });
type Session = { id: string; deviceName?: string; platform?: string; current?: boolean; lastSeenAt?: string; createdAt?: string };
const devices = computed(() => ((sessions.data.value ?? []) as Session[]).filter((x) => x.platform !== "api").sort((a, b) => Number(b.current) - Number(a.current)));
const others = computed(() => devices.value.filter((x) => !x.current).length);
const icon = (x: Session) => (x.platform === "android" || /Android|iPhone/.test(x.deviceName ?? "") ? "device" : "server");
async function endSession(id: string) { try { await api.del(`/auth/sessions/${id}`); sessions.refetch(); toast("Signed out that device"); } catch (e) { toastError(e); } }
async function endOthers() { try { await api.post("/auth/logout-others"); sessions.refetch(); toast("Signed out everywhere else"); } catch (e) { toastError(e); } }

// The password never goes to the server (PLAN.md §4.1): this device turns the current one into its authKey (the
// proof), wraps the data key under the new one and sends the new bundle. The other devices are signed out.
async function changePassword() {
  const current = await prompt("Current password", { secret: true }); if (!current) return;
  const next = await prompt("New password", { text: `At least ${PASSWORD_MIN} characters.`, secret: true, autocomplete: "new-password" }); if (!next) return;
  const again = await prompt("Type it again", { secret: true, autocomplete: "new-password" }); if (!again) return;
  if (again !== next) { toastError(new Error("The passwords don't match")); return; }
  const problem = await passwordProblem(next); if (problem) { toastError(new Error(problem)); return; }
  if (!keyring.isOpen()) { toastError(new Error("This device has not unlocked your journal. Sign out and in again first.")); return; }
  const opened = keyring.generation();
  try {
    toast("Unlocking...");
    const cur = await keysFor(user.value!.username, current);
    // locked during that slow step: nothing more happens, and no copy of the key is made
    const dataKey = keyring.generation() === opened ? keyring.get() : null;
    if (!dataKey) return;
    let bundle;
    try { bundle = await rewrap(dataKey, next); } finally { dataKey.fill(0); }
    if (keyring.generation() !== opened) return;
    await api.post("/auth/password", { current: cur.authKeyText, authKey: bundle.authKey, kdfSalt: bundle.salt, wrappedByPassword: bundle.wrappedByPassword });
    rememberBundle({ salt: bundle.salt, wrappedByPassword: bundle.wrappedByPassword }); // the lock screen takes the new password from now on
    sessions.refetch(); toast("Password changed. Other devices were signed out.");
  } catch (e) { toastError(e); }
}
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
    <div class="li"><div class="grow t">Name</div><input class="ac-in" :value="user?.displayName ?? ''" placeholder="Your name" autocomplete="name" @change="saveMe({ displayName: val($event) })" /></div>
    <div class="li"><div class="grow"><div class="t">Email</div><div class="s">Optional</div></div><input class="ac-in" type="email" :value="user?.email ?? ''" placeholder="you@example.com" autocomplete="email" @change="saveMe({ email: val($event) })" /></div>
    <div v-if="localAccount === false" class="li"><div class="grow t">Password</div><button class="qb" @click="changePassword">Change</button></div>
    <div class="li"><div class="grow"><div class="t">Sign out</div><div class="s">From this device</div></div><button class="qb" @click="signOut()">Sign out</button></div>
  </div>

  <div v-if="sync.on" class="card"><div class="li"><Icon name="refresh" :size="18" class="muted" /><div class="grow"><div class="t">Works offline</div>
    <div class="s">{{ !sync.online ? "Can't reach the server: changes are saved on this device" : sync.syncing ? "Syncing…" : sync.lastAt ? `In sync · ${ago(new Date(sync.lastAt).toISOString())}` : "Getting ready" }}{{ sync.waiting ? ` · ${sync.waiting} waiting to be sent` : "" }}{{ sync.error ? ` · ${sync.error}` : "" }}</div></div>
    <button class="qb" :disabled="sync.syncing" @click="schedule(0)">Sync now</button></div></div>

  <template v-if="localAccount === false">
    <div class="sh"><h2>Signed-in devices</h2><button v-if="others" class="lnk" @click="endOthers">Sign out the others</button></div>
    <p class="tiny hgap">{{ !sessions.data.value ? "" : others ? `This account is also signed in on ${others} other device${others === 1 ? "" : "s"}. Sign out any you don't know.` : "This account isn't signed in anywhere else." }}</p>
    <div class="card flush">
      <div v-for="x in devices" :key="x.id" class="li"><Icon :name="icon(x)" :size="18" class="muted" />
        <div class="grow"><div class="t">{{ x.deviceName || x.platform }}</div>
          <div class="s">{{ x.current ? "This device · active now" : `Last active ${ago(x.lastSeenAt)} · signed in ${fmt.date(x.createdAt, { day: "numeric", month: "short", year: "numeric" })}` }}</div></div>
        <button v-if="!x.current" class="qb" @click="endSession(x.id)">Sign out</button></div>
    </div>
  </template>

  <div v-if="localAccount === true" class="card"><div class="li"><div class="grow"><div class="t">Delete account</div><div class="s">This account is only on this device. Remove it under Servers & accounts.</div></div><button class="qb" @click="router.push('/settings/accounts')">Open</button></div></div>
  <div v-else-if="localAccount === false" class="card"><div class="li"><div class="grow"><div class="t ac-neg">Delete account</div><div class="s">Deletes everything you have in Somnium</div></div><button class="qb danger" @click="deleteAccount">Delete</button></div></div>
</template>

<style scoped>
.ac-head { display: flex; align-items: center; gap: var(--spg); }
.ac-av { width: 56px; height: 56px; border-radius: 50%; flex: none; display: grid; place-items: center; background: var(--accc); color: var(--onc); font-size: 20px; font-weight: 700; letter-spacing: .02em; }
.ac-who { min-width: 0; }
.ac-who .tiny { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ac-name { font-size: 18px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* the control column: same width on every input row so the card reads as one aligned form */
.li > .ac-in { width: min(240px, 58%); max-width: none; flex: none; }
.ac-neg { color: var(--neg); }
</style>
