<script setup lang="ts">
// The account switcher (PLAN.md §2): the person icon at the bottom of the desktop rail, and the top of the phone's More
// page. The open account, a quick list of the others to switch to, and Manage (Settings → Servers & accounts).
// In a browser there is only the site's own server, so it shows who is signed in there.
import { computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { orderAccounts, type AccountEntry } from "@somnium/shared";
import Icon from "../components/Icon.vue";
import Menu from "../components/Menu.vue";
import { session, signOut } from "../core/session";
import { saved, refreshAccounts, nativeAccounts, labelFor, currentSyncLabel, switchTo, webServerName, deviceWord } from "../core/accounts";

defineProps<{ variant: "rail" | "card" }>();
const router = useRouter();
const nat = nativeAccounts();
onMounted(refreshAccounts);

interface Row { id: string; name: string; where: string; open: boolean }
const rows = computed<Row[]>(() => {
  if (!nat) return [{ id: "", name: session.user?.username ?? "Account", where: `${webServerName.value} · ${currentSyncLabel()}`, open: true }];
  const o = orderAccounts(saved);
  const row = (a: AccountEntry, where: string): Row => ({ id: a.id, name: a.kind === "local" ? a.name : (a.id === saved.active ? session.user?.username : a.user) || "Not signed in", where: a.kind === "local" ? where : `${where} · ${labelFor(a)}`, open: a.id === saved.active });
  return [...o.device.map((a) => row(a, "On this " + deviceWord())), ...o.servers.flatMap((g) => g.accounts.map((a) => row(a, g.server.name)))];
});
const cur = computed(() => rows.value.find((r) => r.open) ?? rows.value[0]);
const others = computed(() => rows.value.filter((r) => !r.open));
const manage = () => router.push("/settings/accounts");
type Item = { label: string; hint?: string; icon: string; checked?: boolean; sep?: boolean; run: () => void };
const items = computed<Item[]>(() => [
  ...(cur.value ? [{ label: cur.value.name, hint: cur.value.where, icon: "user", checked: true, run: () => router.push("/settings/account") }] : []),
  ...others.value.map((r, i) => ({ label: r.name, hint: r.where, icon: "swap", sep: i === 0, run: () => void switchTo(r.id) })),
  { label: nat ? "Manage servers & accounts" : "Manage server", icon: "server", sep: true, run: manage },
  ...(session.user ? [{ label: "Sign out", icon: "logout", run: () => void signOut() }] : []),
]);
</script>

<template>
  <Menu v-if="variant === 'rail'" :items="items" icon="user" label="Accounts" />
  <!-- each row is a button: reached with Tab, run with Enter or Space, and read out as what it does -->
  <div v-else class="card flush acsw">
    <button v-if="cur" type="button" class="li click" @click="router.push('/settings/account')">
      <span class="bi sg"><Icon name="user" :size="17" /></span>
      <span class="grow"><span class="t">{{ cur.name }}</span><span class="s">{{ cur.where }}</span></span>
      <span class="tiny acc">In use</span>
    </button>
    <button v-for="r in others" :key="r.id" type="button" class="li click" :aria-label="`Switch to ${r.name}, ${r.where}`" @click="switchTo(r.id)">
      <span class="bi sg"><Icon name="swap" :size="17" /></span>
      <span class="grow"><span class="t">{{ r.name }}</span><span class="s">{{ r.where }}</span></span>
      <span class="qb" aria-hidden="true">Switch</span>
    </button>
    <button type="button" class="li click" @click="manage">
      <span class="bi sg"><Icon name="server" :size="17" /></span>
      <span class="grow"><span class="t">{{ nat ? "Manage servers & accounts" : "Manage server" }}</span></span>
      <Icon name="right" :size="16" class="muted" />
    </button>
  </div>
</template>

<style scoped>
.acsw .li { width: 100%; background: none; border-left: 0; border-right: 0; border-top: 0; color: var(--tx); text-align: start; font: inherit; cursor: pointer; }
.acsw .t, .acsw .s { display: block; }
</style>
