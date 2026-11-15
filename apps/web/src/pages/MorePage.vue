<script setup lang="ts">
// The phone's More tab: the account switcher, then the pages that have no tab of their own (PLAN.md §2, §6.0;
// Motus's More page). Names and icons match the desktop rail (shell/nav.ts).
import { useRouter } from "vue-router";
import Icon from "../components/Icon.vue";
import AccountSwitcher from "../shell/AccountSwitcher.vue";
import { useNeedsRecoveryKey } from "../core/recoveryNudge";
import { useToConfirmCount } from "../components/signs/useSigns";

const router = useRouter();
// the same dot as on the More tab, on the row it leads to (LDJ-151)
const needsKey = useNeedsRecoveryKey();
// and the To confirm count on Dream signs, as on the More tab (LDJ-125)
const toConfirm = useToConfirmCount();
const ITEMS = [
  { label: "Dream signs", hint: "What keeps showing up in your dreams", icon: "eye", to: "/signs" },
  { label: "Learn", hint: "Articles, glossary, FAQ", icon: "graduation", to: "/learn" },
  { label: "Settings", hint: "Account, security, appearance, features", icon: "settings", to: "/settings" },
];
</script>

<template>
  <div class="page">
    <div class="ph"><div><h1>More</h1></div></div>
    <!-- who is open here, and the others to switch to (PLAN.md §2) -->
    <div class="stack">
      <AccountSwitcher variant="card" />
      <div class="sh"><h2>Pages</h2></div>
      <div class="card flush">
        <button type="button" v-for="i in ITEMS" :key="i.to" class="li click" @click="router.push(i.to)"><span class="bi sg"><Icon :name="i.icon" :size="17" /></span><div class="grow"><div class="t">{{ i.label }}</div><div class="s">{{ i.hint }}</div></div><i v-if="i.to === '/settings' && needsKey" class="ndot" role="img" aria-label="Make your recovery key" /><i v-if="i.to === '/signs' && toConfirm" class="ncnt" role="img" :aria-label="`${toConfirm} to confirm`">{{ toConfirm }}</i><Icon name="right" :size="16" class="muted" /></button>
      </div>
    </div>
  </div>
</template>
