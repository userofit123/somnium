<script setup lang="ts">
import { onBeforeUnmount, onMounted, watch } from "vue";
import { useRoute } from "vue-router";
// Panels any screen can open: Appearance, the + sheet, and the command palette (an optional feature). They are only
// mounted with the journal open (App.vue): locking unmounts them, so nothing of them shows behind the lock.
import AppearancePanel from "./AppearancePanel.vue";
import { useSettings } from "../api/queries";
import { startAutoBackups } from "../core/backup";
import { toast } from "../core/toast";
import CommandPalette from "./CommandPalette.vue";
import StartSheet from "./StartSheet.vue";
import { startOpen } from "../core/ui";
import { overlayIsOpen } from "../core/sheets";

// automatic backups (Settings → Backup): checked when the journal opens and every hour; where the browser can't save
// files on its own, a due backup is offered as a download once per visit
const settings = useSettings();
// the sound cue switched off in Settings → Features: a session still playing (it outlives its screen, cueSession.ts) stops.
// Loaded only then: nothing of it is in the first download.
watch(() => !!settings.value.features?.soundCue, (on, was) => {
  if (!on && was) void import("../components/train/guided/cueSession").then((m) => (m.cueSession.on.value ? m.stopCueSession() : 0)).catch(() => {});
});
startAutoBackups(() => settings.value?.backup ?? null, (run) => toast("A backup is due", { action: { label: "Download", run }, ms: 12000 }));

// N opens the + sheet from anywhere on a computer (Motus); not while typing, over a sheet, dialog or menu, or while a dream is being written or captured
const route = useRoute();
const key = (e: KeyboardEvent) => {
  if (e.key !== "n" || e.metaKey || e.ctrlKey || e.altKey || route.name === "capture" || route.name === "journal-write" || overlayIsOpen()) return;
  if ((e.target as HTMLElement).closest?.("input,textarea,select,[contenteditable]")) return;
  startOpen.value = true;
};
onMounted(() => addEventListener("keydown", key));
// locked (or signed out) with the sheet open: it doesn't come back by itself when the journal opens again
onBeforeUnmount(() => { removeEventListener("keydown", key); startOpen.value = false; });
</script>

<template>
  <AppearancePanel />
  <StartSheet v-if="startOpen" @close="startOpen = false" />
  <CommandPalette v-if="settings.features.palette" />
</template>
