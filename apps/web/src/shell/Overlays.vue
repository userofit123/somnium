<script setup lang="ts">
// Panels any screen can open: Appearance, and the command palette (an optional feature).
import AppearancePanel from "./AppearancePanel.vue";
import { useSettings } from "../api/queries";
import { startAutoBackups } from "../core/backup";
import { toast } from "../core/toast";
import CommandPalette from "./CommandPalette.vue";

// automatic backups (Settings → Backup): checked when the journal opens and every hour; where the browser can't save
// files on its own, a due backup is offered as a download once per visit
const settings = useSettings();
startAutoBackups(() => settings.value?.backup ?? null, (run) => toast("A backup is due", { action: { label: "Download", run }, ms: 12000 }));
</script>

<template>
  <AppearancePanel />
  <CommandPalette v-if="settings.features.palette" />
</template>
