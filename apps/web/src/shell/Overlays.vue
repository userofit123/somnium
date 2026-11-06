<script setup lang="ts">
// Panels any screen can open: Appearance, and the command palette (an optional feature).
import AppearancePanel from "./AppearancePanel.vue";
import { watch } from "vue";
import { useSettings } from "../api/queries";
import { maybeAutoBackup } from "../core/backup";
import { toast } from "../core/toast";
import CommandPalette from "./CommandPalette.vue";

// an automatic backup when one is due (Settings → Backup)
const settings = useSettings();
let checked = false;
watch(settings, (s) => {
  if (checked || !s) return; checked = true;
  setTimeout(() => maybeAutoBackup(s.backup, (run) => toast("A backup is due", { action: { label: "Download", run }, ms: 12000 })), 4000);
});
</script>

<template>
  <AppearancePanel />
  <CommandPalette v-if="settings.features.palette" />
</template>
