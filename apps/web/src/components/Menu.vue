<script setup lang="ts">
// The ⋮ menu: where secondary actions live, so screens stay calm (PLAN.md §10.0).
import { ref, nextTick, onBeforeUnmount } from "vue";
import { lockScroll } from "../core/scrollLock";
import { isPhone, safeArea } from "../core/device";
import Icon from "./Icon.vue";

// checked: the one chosen among options (a set's type, a side), marked with a tick at the end so every item keeps its own icon
export interface MenuItem { label: string; hint?: string; icon?: string; run: () => void; danger?: boolean; sep?: boolean; hidden?: boolean; checked?: boolean }
// align "start": the menu opens from the button's left edge (as far as the screen allows), for a button that isn't the
// last thing in its row; otherwise its right edge lines up with the button's
const props = defineProps<{ items: MenuItem[]; icon?: string; label?: string; align?: "start" | "end" }>();
const open = ref(false), pos = ref({ top: 0, left: 0 }), btn = ref<HTMLElement | null>(null), el = ref<HTMLElement | null>(null);
// on the phone the menu is a bottom sheet over a scrim, so the page stays still behind it; on a computer it is a small popover with
// no scrim, and locking would shift fixed elements (the add button, minibars) by the scrollbar width on every open
let unlock = () => {};
async function toggle() {
  open.value = !open.value;
  if (!open.value) { unlock(); unlock = () => {}; return; }
  if (isPhone.value) unlock = lockScroll();
  const b = btn.value!.getBoundingClientRect();
  pos.value = { top: b.bottom + 6, left: b.right };
  await nextTick();
  const m = el.value!.getBoundingClientRect();
  // the Android app draws under its bars, so the screen's edges are the bars' inner edges, not the window's
  const sa = safeArea(), lo = innerHeight - sa.bottom - 8, hi = sa.top + 8;
  pos.value = { top: b.bottom + 6 + m.height > lo ? Math.max(hi, b.top - m.height - 6) : b.bottom + 6, left: Math.max(sa.left + 8, Math.min(props.align === "start" ? b.left : b.right - m.width, innerWidth - sa.right - m.width - 8)) };
  setTimeout(() => addEventListener("click", away, true));
}
const away = (e: Event) => { if (!el.value?.contains(e.target as Node)) { e.stopPropagation(); close(); } };
const close = () => { open.value = false; unlock(); unlock = () => {}; removeEventListener("click", away, true); };
const pick = (i: MenuItem) => { close(); i.run(); };
onBeforeUnmount(close);
</script>

<template>
  <button ref="btn" class="ib sm plain" :aria-label="label ?? 'More'" @click.stop="toggle"><Icon :name="icon ?? 'more'" /></button>
  <Teleport to="body">
    <div v-if="open" ref="el" class="mnu" :style="{ top: pos.top + 'px', left: pos.left + 'px' }" role="menu">
      <template v-for="(i, k) in props.items.filter((x) => !x.hidden)" :key="k">
        <hr v-if="i.sep" />
        <button :class="{ danger: i.danger, on: i.checked }" :role="i.checked != null ? 'menuitemradio' : 'menuitem'" :aria-checked="i.checked ?? undefined" @click="pick(i)"><Icon v-if="i.icon" :name="i.icon" :size="18" /><span v-if="i.hint" class="mh"><span>{{ i.label }}</span><small>{{ i.hint }}</small></span><span v-else class="ml">{{ i.label }}</span><Icon v-if="i.checked" name="check" :size="16" class="mck" /></button>
      </template>
    </div>
  </Teleport>
</template>
