<script setup lang="ts">
// The phone's More tab: the account switcher, then the pages that have no tab of their own (PLAN.md §2, §6).
import { useRouter } from "vue-router";
import Icon from "../components/Icon.vue";
import AccountSwitcher from "../shell/AccountSwitcher.vue";

const router = useRouter();
const ITEMS = [
  { label: "Signs", hint: "Dream signs and elements", icon: "sparkle", to: "/signs" },
  { label: "Settings", hint: "Account, security, appearance, features", icon: "settings", to: "/settings" },
];
</script>

<template>
  <div class="page">
    <div class="ph"><div><h1>More</h1></div></div>
    <!-- who is open here, and the others to switch to (PLAN.md §2) -->
    <div class="stack">
      <AccountSwitcher variant="card" />
      <div class="card flush">
        <button type="button" v-for="i in ITEMS" :key="i.to" class="li click" @click="router.push(i.to)"><span class="bi sg"><Icon :name="i.icon" :size="17" /></span><div class="grow"><div class="t">{{ i.label }}</div><div class="s">{{ i.hint }}</div></div><Icon name="right" :size="16" class="muted" /></button>
      </div>
    </div>
  </div>
</template>
