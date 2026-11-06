<script setup lang="ts">
// The app's own drop-down list, in place of the browser's <select> (whose list is drawn by the browser or the phone, not
// in the app's look). Options are plain strings or { value, label }; options with a `group` go under that heading.
// Keys as on a <select>: arrows, Home/End, Enter or Space, Esc, and typing a name's first letters jumps to it.
// Slot "end" (given the option) adds something at the right of each option, e.g. a button that plays a sound; it must
// stop its own click, or the click picks the option too.
import { computed, nextTick, ref, useId, watch } from "vue";
import { isPhone } from "../core/device";
import Icon from "./Icon.vue";
import PickerPop from "./PickerPop.vue";

export interface SelectOption { value: any; label: string; hint?: string; group?: string; disabled?: boolean }
defineOptions({ inheritAttrs: false });
const props = defineProps<{ modelValue: any; options: (string | SelectOption)[]; placeholder?: string; disabled?: boolean; title?: string }>();
const emit = defineEmits<{ "update:modelValue": [v: any]; change: [v: any] }>();

const id = useId();
const opts = computed<SelectOption[]>(() => props.options.map((o) => (typeof o === "string" ? { value: o, label: o } : o)));
// shown under their headings, in the order the headings first appear; `flat` is that same order, for the keys
const groups = computed(() => {
  const m = new Map<string, SelectOption[]>();
  for (const o of opts.value) m.set(o.group ?? "", [...(m.get(o.group ?? "") ?? []), o]);
  return [...m];
});
const flat = computed(() => groups.value.flatMap(([, os]) => os));
const cur = computed(() => opts.value.find((o) => o.value === props.modelValue));
const open = ref(false), hi = ref(-1), btn = ref<HTMLButtonElement | null>(null);

function show() {
  if (props.disabled || open.value) return;
  hi.value = flat.value.findIndex((o) => o.value === props.modelValue);
  if (hi.value < 0) hi.value = step(-1, 1);
  open.value = true;
}
function close(refocus = true) { open.value = false; if (refocus && !isPhone.value) btn.value?.focus({ preventScroll: true }); }
function pick(o: SelectOption) {
  if (o.disabled) return;
  close();
  if (o.value !== props.modelValue) { emit("update:modelValue", o.value); emit("change", o.value); }
}
/** the next option that can be chosen, from `from` going `d` (stays put at either end) */
function step(from: number, d: number) {
  for (let i = from + d; i >= 0 && i < flat.value.length; i += d) if (!flat.value[i]!.disabled) return i;
  return from;
}
watch([hi, open], async () => { await nextTick(); if (open.value) document.getElementById(`${id}-${hi.value}`)?.scrollIntoView({ block: "nearest" }); });

let typed = "", typedAt = 0;
function key(e: KeyboardEvent) {
  const n = flat.value.length;
  if (e.key === "Escape") { if (open.value) { e.preventDefault(); e.stopPropagation(); close(); } return; }
  if (e.key === "Tab") { open.value = false; return; }
  if (!n || e.ctrlKey || e.metaKey || e.altKey) return;
  const typing = e.key.length === 1 && (e.key !== " " || (typed && Date.now() - typedAt < 700));
  if (typing) {
    e.preventDefault();
    typed = Date.now() - typedAt < 700 ? typed + e.key.toLowerCase() : e.key.toLowerCase(); typedAt = Date.now();
    // the same letter again moves on to the next name starting with it
    const again = typed.length > 1 && [...typed].every((c) => c === typed[0]), q = again ? typed[0]! : typed;
    const start = again || typed.length === 1 ? hi.value + 1 : Math.max(0, hi.value);
    for (let k = 0; k < n; k++) {
      const i = (start + k) % n, o = flat.value[i]!;
      if (!o.disabled && o.label.toLowerCase().startsWith(q)) { show(); hi.value = i; break; }
    }
    return;
  }
  switch (e.key) {
    case "ArrowDown": case "ArrowUp":
      e.preventDefault();
      if (!open.value) show(); else hi.value = step(hi.value, e.key === "ArrowDown" ? 1 : -1);
      break;
    case "Home": case "End":
      if (!open.value) return;
      e.preventDefault(); hi.value = e.key === "Home" ? step(-1, 1) : step(n, -1);
      break;
    case "Enter": case " ":
      e.preventDefault();
      if (open.value && flat.value[hi.value]) pick(flat.value[hi.value]!); else show();
      break;
  }
}
</script>

<template>
  <button ref="btn" type="button" class="fpick" v-bind="$attrs" role="combobox" aria-haspopup="listbox" :aria-expanded="open" :aria-controls="open ? `${id}-l` : undefined"
    :aria-activedescendant="open && hi >= 0 ? `${id}-${hi}` : undefined" :disabled="disabled" @click="open ? close() : show()" @keydown="key">
    <span class="v" :class="{ unset: !cur }">{{ cur?.label ?? placeholder ?? "" }}</span><Icon name="down" :size="16" />
  </button>
  <PickerPop v-if="open" :anchor="btn" :title="title ?? placeholder ?? 'Choose'" @close="close(false)">
    <div :id="`${id}-l`" class="asl" role="listbox">
      <template v-for="[g, os] in groups" :key="g">
        <div v-if="g" class="asg" role="presentation">{{ g }}</div>
        <div v-for="o in os" :id="`${id}-${flat.indexOf(o)}`" :key="String(o.value)" class="aso" role="option" :aria-selected="o.value === modelValue" :aria-disabled="o.disabled || undefined"
          :class="{ sel: o.value === modelValue, hi: flat.indexOf(o) === hi, dis: o.disabled }" @click="pick(o)" @mousemove="!o.disabled && (hi = flat.indexOf(o))">
          <span class="ol"><span>{{ o.label }}</span><small v-if="o.hint">{{ o.hint }}</small></span><Icon name="check" :size="16" />
          <slot name="end" :option="o" />
        </div>
      </template>
    </div>
  </PickerPop>
</template>

<style scoped>
.asg { padding: 8px 12px 4px; font-size: var(--fs-xs); font-weight: 700; letter-spacing: .7px; text-transform: uppercase; color: var(--tx2); }
.aso { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 9px 12px; border-radius: 10px; font-size: var(--fs); line-height: 1.3; color: var(--tx); cursor: pointer; }
.aso.hi { background: var(--s2); }
.aso.sel { color: var(--acc); font-weight: 600; }
.aso.dis { opacity: .4; cursor: default; }
.aso > .ico { flex: none; opacity: 0; }
.aso.sel > .ico { opacity: 1; }
/* with something at the end, the label takes the room and the tick sits next to it */
.aso > .ol { flex: 1; }
.ol { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.ol small { font-size: var(--fs-sm); font-weight: 400; color: var(--tx2); }
/* a sheet on the phone: rows big enough for a thumb */
.sh_b .asl { margin: 0 -10px; }
.sh_b .aso { min-height: var(--lmh); padding: var(--lpy) 12px; font-size: var(--fs-lg); border-radius: var(--r-sm); }
</style>
