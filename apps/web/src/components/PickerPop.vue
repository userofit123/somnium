<script setup lang="ts">
// Where the app's pickers (AppSelect, DatePicker, TimePicker) open, instead of the browser's own: a panel under the field
// on a computer (above it when there's no room below), a bottom sheet on the phone, where a small panel is hard to hit.
// On a computer the field keeps the focus (the pickers read the keys there), so a press in the panel must not take it.
import { onBeforeUnmount, onMounted, ref } from "vue";
import { isPhone, safeArea } from "../core/device";
import Sheet from "./Sheet.vue";

const props = defineProps<{ anchor: HTMLElement | null; title: string }>();
const emit = defineEmits<{ close: [] }>();
// decided once: the layout changing while it's open must not swap a sheet for a panel mid-pick
const phone = isPhone.value;
const el = ref<HTMLElement | null>(null), up = ref(false), shown = ref(false);

function place() {
  const a = props.anchor, m = el.value;
  if (!a || !m) return;
  const b = a.getBoundingClientRect();
  m.style.minWidth = b.width + "px"; m.style.maxHeight = "";
  // a tablet's home bar or a notch is no room for the panel (safeArea: the page's own insets)
  const sa = safeArea(), h = m.offsetHeight, w = m.offsetWidth, below = innerHeight - sa.bottom - b.bottom - 14, above = b.top - sa.top - 14;
  up.value = h > below && above > below;
  const mh = Math.min(h, up.value ? above : below);
  m.style.maxHeight = mh + "px";
  m.style.top = (up.value ? b.top - 6 - mh : b.bottom + 6) + "px";
  const x = getComputedStyle(a).direction === "rtl" ? b.right - w : b.left;
  m.style.left = Math.max(sa.left + 8, Math.min(x, innerWidth - sa.right - w - 8)) + "px";
}
const away = (e: Event) => {
  const t = e.target as HTMLElement;
  // the field's own label counts as the field: a press there toggles it like the field does
  if (el.value?.contains(t) || props.anchor?.contains(t) || props.anchor?.closest("label")?.contains(t)) return;
  // a press on a sheet's backdrop closes only this panel, not the sheet under it
  if (t.classList?.contains("scr")) e.stopPropagation();
  emit("close");
};
// fields inside the panel (a colour's hex, its hue slider) still take the focus and the drag
const keepFocus = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest("input, textarea")) e.preventDefault(); };
const onScroll =(e: Event) => { if (!el.value?.contains(e.target as Node)) place(); };
const onResize = () => emit("close");
onMounted(() => {
  if (phone) return;
  place();
  requestAnimationFrame(() => { shown.value = true; });
  addEventListener("mousedown", away, true); addEventListener("scroll", onScroll, true); addEventListener("resize", onResize);
});
onBeforeUnmount(() => { removeEventListener("mousedown", away, true); removeEventListener("scroll", onScroll, true); removeEventListener("resize", onResize); });
defineExpose({ place });
</script>

<template>
  <Sheet v-if="phone" :title="title" @close="emit('close')"><slot /></Sheet>
  <Teleport v-else to="body">
    <div ref="el" class="ddm pkp" :class="{ up, in: shown }" @mousedown="keepFocus"><slot /></div>
  </Teleport>
</template>

<style scoped>
.pkp { max-width: min(420px, calc(100vw - 16px)); }
</style>
