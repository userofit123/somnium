<script setup lang="ts">
// Shows only when a newer version exists (no badge otherwise, PLAN.md §10.0). In the apps it follows the app's own
// checks (automatic ones only when switched on, App & Versions), so turning those off means no checking here either;
// in a browser it asks the server whether it is behind.
import { computed } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useRouter } from "vue-router";
import { api } from "../api/client";
import { updater } from "../core/updater";
import { detectPlatform, newer } from "../core/releases";
import Icon from "../components/Icon.vue";
const router = useRouter();
const app = detectPlatform().app;
const upd = useQuery({ queryKey: ["static", "update"], queryFn: () => api.get("/update-check"), staleTime: 6 * 3600_000, refetchOnWindowFocus: false, enabled: !app });
const latest = computed(() => (app
  ? (updater.latest && updater.appVersion && newer(updater.latest, updater.appVersion) ? updater.latest : "")
  : upd.data.value?.newer ? upd.data.value.latest : ""));
</script>

<template>
  <button v-if="latest" type="button" class="nb upd" :title="`Version ${latest} is available`" @click="router.push('/settings/versions')">
    <span class="ic"><Icon name="download" :size="22" /></span>Update
  </button>
</template>
