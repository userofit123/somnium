<script setup lang="ts">
// Server admin: people on this server (invite, disable, reset password, turn two-factor off, make admin, remove), who may
// sign up, and invites. The server never sees a password (PLAN.md §4.1), so an admin cannot set one: new people
// join with an invite link, and a lost password gets a one-time reset code. The journal stays sealed after a
// reset until the person's recovery key or a signed-in device re-wraps the data key (§4.4).
import { useFmt } from "../../core/format";
import { useQuery } from "@tanstack/vue-query";
import { api } from "../../api/client";
import { prompt, confirm } from "../../core/ask";
import { toast, toastError } from "../../core/toast";
import { session } from "../../core/session";
import Menu from "../Menu.vue";
import AppSelect from "../AppSelect.vue";

const users = useQuery({ queryKey: ["settings", "admin-users"], queryFn: () => api.get("/admin/users") });
const cfg = useQuery({ queryKey: ["settings", "admin-cfg"], queryFn: () => api.get("/admin/settings") });
const run = async (fn: () => Promise<unknown>, msg?: string) => { try { await fn(); users.refetch(); cfg.refetch(); if (msg) toast(msg); } catch (e) { toastError(e); } };
async function reset(u: any) {
  if (!(await confirm(`Reset the password for ${u.username}?`, { text: "They get a one-time code to choose a new password. Their dreams stay sealed until they use their recovery key or a device that is still signed in.", ok: "Make a reset code" }))) return;
  try {
    const r = await api.put(`/admin/users/${u.id}`, { resetPassword: true });
    await navigator.clipboard?.writeText(r.resetCode).catch(() => {});
    await confirm(`Reset code for ${u.username}`, { text: `${r.resetCode}\n\nCopied. Valid for one day. On the sign-in screen they choose "Forgot password?", then "I have a reset code".`, ok: "Done" });
    users.refetch();
  } catch (e) { toastError(e); }
}
async function turnOff2fa(u: any) {
  if (await confirm(`Turn off two-factor for ${u.username}?`, { text: "Their password alone will sign them in, and their backup codes stop working. Do this only when you know it is them asking.", ok: "Turn off", danger: true }))
    run(() => api.put(`/admin/users/${u.id}`, { disable2fa: true }), "Two-factor sign-in is off for them");
}
async function remove(u: any) { if (await confirm(`Remove ${u.username}?`, { text: "Everything they have in Somnium is deleted.", ok: "Remove", danger: true })) run(() => api.del(`/admin/users/${u.id}`), "Removed"); }
async function invite() {
  const r = await api.post("/admin/invites");
  const link = `${location.origin}/?invite=${r.code}`;
  await navigator.clipboard?.writeText(link).catch(() => {});
  toast("Invite link copied (valid 14 days)"); cfg.refetch();
}
const fmt = useFmt();
</script>

<template>
  <div class="stack">
    <div class="sh first"><h2>People</h2><button class="lnk" @click="invite">Invite</button></div>
    <div class="card"><div v-for="u in users.data.value ?? []" :key="u.id" class="li">
      <div class="grow"><div class="t">{{ u.displayName || u.username }} <span class="tiny">@{{ u.username }}</span><span v-if="u.role === 'admin'" class="mchip" style="margin-inline-start:6px">admin</span><span v-if="u.disabled" class="mchip" style="margin-inline-start:6px">disabled</span><span v-if="u.totpEnabled" class="mchip" style="margin-inline-start:6px">2FA</span></div>
        <div class="s">Joined {{ fmt.date(u.createdAt) }}{{ u.lastSeenAt ? ` · last seen ${fmt.date(u.lastSeenAt)}` : "" }}</div></div>
      <Menu v-if="u.id !== session.user?.id" :items="[{ label: 'Reset password', icon: 'key', run: () => reset(u) }, ...(u.totpEnabled ? [{ label: 'Turn off two-factor', icon: 'lock', run: () => turnOff2fa(u) }] : []), { label: u.role === 'admin' ? 'Remove admin' : 'Make admin', icon: 'user', run: () => run(() => api.put(`/admin/users/${u.id}`, { role: u.role === 'admin' ? 'user' : 'admin' }), u.role === 'admin' ? 'No longer an admin' : 'Made admin') },
        { label: u.disabled ? 'Enable' : 'Disable', icon: 'lock', run: () => run(() => api.put(`/admin/users/${u.id}`, { disabled: !u.disabled }), u.disabled ? 'Account enabled' : 'Account disabled') }, { label: 'Remove', icon: 'trash', danger: true, sep: true, run: () => remove(u) }]" />
    </div></div>
    <p class="tiny">Admins manage accounts but never see anyone's dreams or data.</p>
    <div class="sh"><h2>Sign-ups</h2></div>
    <div class="card">
      <div class="li"><div class="grow"><div class="t">Who can create an account</div></div><AppSelect :model-value="cfg.data.value?.registration" :options="[{ value: 'closed', label: 'Only the admin' }, { value: 'invite', label: 'People with an invite' }, { value: 'open', label: 'Anyone who can reach this server' }]" title="Who can create an account" style="width:auto" @update:model-value="(v) => run(() => api.put('/admin/settings', { registration: v }), 'Saved')" /></div>
      <div class="li"><div class="grow"><div class="t">Invite someone</div><div class="s">Copies a sign-up link</div></div><button class="btn o s" @click="invite">Copy link</button></div>
      <div v-for="i in cfg.data.value?.invites ?? []" :key="i.code" class="li tiny"><span class="grow" style="font-family:monospace">{{ i.code }}</span>{{ i.used ? "used" : `until ${fmt.date(i.expiresAt)}` }}</div>
    </div>
  </div>
</template>
