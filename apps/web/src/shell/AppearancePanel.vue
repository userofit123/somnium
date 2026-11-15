<script setup lang="ts">
// The rail's quick Appearance panel: a popover on a computer, a bottom sheet on a phone. The options themselves are
// AppearanceBody, which Settings → Appearance shows inline too.
import { ref, watch, onMounted, onBeforeUnmount } from "vue";
import AppearanceBody from "./AppearanceBody.vue";
import { appearanceOpen } from "../core/ui";
import { sheetOpened, sheetClosed } from "../core/sheets";
import { isPhone } from "../core/device";
import { lockScroll } from "../core/scrollLock";
import { usePullDown } from "../core/pullDown";

// Back closes it like any sheet, instead of leaving the page behind it
let backId = 0, unlock = () => {};
watch(appearanceOpen, (o) => {
  unlock();
  if (o) { backId = sheetOpened(() => (appearanceOpen.value = false)); if (isPhone.value) unlock = lockScroll(); } // phone only: a bottom sheet with a scrim; on a computer the lock would shift fixed elements by the scrollbar width
  else {
    unlock = () => {};
    if (backId) sheetClosed(backId); backId = 0;
    if (pull.pulledAway) return; // it already slid away under the finger
    out.value = true; setTimeout(() => (out.value = false), 200);
  }
});
const close = () => { appearanceOpen.value = false; };
const out = ref(false);
const el = ref<HTMLElement | null>(null);
// on the phone it is a bottom sheet: pull it down to close, like the others
const pull = usePullDown(() => el.value, () => document.querySelector<HTMLElement>(".apscr"), () => appearanceOpen.value, close);
const outside = (e: Event) => { if (appearanceOpen.value && el.value && !el.value.contains(e.target as Node) && !(e.target as HTMLElement).closest?.("#themeBtn")) close(); };
const esc = (e: KeyboardEvent) => { if (e.key === "Escape" && appearanceOpen.value) close(); };
onMounted(() => { document.addEventListener("click", outside, true); addEventListener("keydown", esc); });
onBeforeUnmount(() => { unlock(); document.removeEventListener("click", outside, true); removeEventListener("keydown", esc); });
</script>

<template>
  <!-- on the phone it's a bottom sheet over a scrim, like the other sheets; a tap on the scrim closes it -->
  <div v-if="isPhone && appearanceOpen" class="scr apscr" aria-hidden="true" />
  <div id="pop" ref="el" class="pop" :class="{ on: appearanceOpen, out }" role="dialog" aria-label="Appearance">
    <AppearanceBody />
  </div>
</template>
