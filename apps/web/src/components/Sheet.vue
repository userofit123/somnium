<script setup lang="ts">
// A sheet: a bottom sheet on the phone, a centred window on a computer. Closes with Esc, Back, a tap outside,
// or on the phone by pulling it down (from anywhere on it, unless its content is scrolled down).
import { onMounted, onBeforeUnmount, ref } from "vue";
import { usePullDown } from "../core/pullDown";
import { sheetOpened, sheetClosed } from "../core/sheets";
import { lockScroll } from "../core/scrollLock";
import Icon from "./Icon.vue";

// noHistory: no Back step of its own (see core/leave.ts)
const props = defineProps<{ title?: string; size?: "wide" | "full"; noClose?: boolean; noHistory?: boolean }>();
const emit = defineEmits<{ close: [] }>();
const root = ref<HTMLElement | null>(null), sheet = ref<HTMLElement | null>(null);
// with sheets stacked (a preview over a picker) Esc closes only the one on top
const onTop = () => [...document.querySelectorAll(".scr:not(.leaving)")].at(-1) === root.value;
const key = (e: KeyboardEvent) => { if (e.key === "Escape" && !props.noClose && onTop()) { e.stopPropagation(); emit("close"); } };
defineExpose({ onTop });
let backId = 0, unlock = () => {};
onMounted(() => {
  addEventListener("keydown", key); unlock = lockScroll();
  if (!props.noClose && !props.noHistory) backId = sheetOpened(() => emit("close"));
});
const pull = usePullDown(() => sheet.value, () => root.value, () => !props.noClose, () => emit("close"));
// However a sheet is closed (its own buttons or the page), a copy of it plays the closing animation for a moment.
onBeforeUnmount(() => {
  removeEventListener("keydown", key); unlock();
  if (backId) sheetClosed(backId);
  const el = root.value;
  if (!el || pull.pulledAway || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const ghost = el.cloneNode(true) as HTMLElement;
  ghost.classList.add("leaving"); ghost.setAttribute("aria-hidden", "true"); ghost.style.pointerEvents = "none";
  document.body.appendChild(ghost);
  setTimeout(() => ghost.remove(), 240);
});

</script>

<template>
  <Teleport to="body">
    <div ref="root" class="scr" @mousedown.self="!noClose && emit('close')">
      <div ref="sheet" class="sht" :class="size" role="dialog" :aria-label="title">
        <div class="sh_h">
          <slot name="head"><b>{{ title }}</b></slot>
          <button v-if="!noClose" class="ib sm plain" aria-label="Close" @click="emit('close')"><Icon name="close" /></button>
        </div>
        <div class="sh_b"><slot /></div>
        <div v-if="$slots.foot" class="sh_f"><slot name="foot" /></div>
      </div>
    </div>
  </Teleport>
</template>
