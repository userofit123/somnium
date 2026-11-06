<script setup lang="ts">
// Choosing from a handful of options inside a form, laid out as an even grid of tiles instead of a ragged row of pills,
// so a form reads as labelled fields. With icons and hints for a few meaningful choices (what a goal is about); `compact`
// for plain short labels (rest presets, weekdays); `multiple` for picking several (muscles, a gym's equipment).
// Long single-choice lists belong in AppSelect, two to four short words in a .seg.
import Icon from "./Icon.vue";

export interface ChoiceOption { value: any; label: string; icon?: string; hint?: string }
const props = defineProps<{ modelValue: any; options: ChoiceOption[]; multiple?: boolean; compact?: boolean; cols?: number; min?: string; label?: string }>();
const emit = defineEmits<{ "update:modelValue": [v: any] }>();

const on = (o: ChoiceOption) => (props.multiple ? (props.modelValue as any[] ?? []).includes(o.value) : props.modelValue === o.value);
function pick(o: ChoiceOption) {
  if (!props.multiple) { if (!on(o)) emit("update:modelValue", o.value); return; }
  const cur = (props.modelValue as any[]) ?? [];
  emit("update:modelValue", on(o) ? cur.filter((v) => v !== o.value) : [...cur, o.value]);
}
// arrows move between tiles as in any option group; Space or Enter picks (it is a button)
function key(e: KeyboardEvent) {
  const box = e.currentTarget as HTMLElement, rtl = getComputedStyle(box).direction === "rtl";
  const d = { ArrowDown: 1, ArrowUp: -1, ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1 }[e.key];
  if (!d) return;
  const bs = [...box.querySelectorAll<HTMLButtonElement>("button")], i = bs.indexOf(document.activeElement as HTMLButtonElement);
  if (i < 0) return;
  e.preventDefault();
  bs[(i + d + bs.length) % bs.length]?.focus();
}
const grid = () => (props.cols ? `repeat(${props.cols}, minmax(0, 1fr))` : `repeat(auto-fill, minmax(min(${props.min ?? (props.compact ? "104px" : "150px")}, 100%), 1fr))`);
</script>

<template>
  <div class="ct" :class="{ cmp: compact, multi: multiple }" :role="multiple ? 'group' : 'radiogroup'" :aria-label="label" :style="{ gridTemplateColumns: grid() }" @keydown="key">
    <button v-for="o in options" :key="String(o.value)" type="button" :role="multiple ? 'checkbox' : 'radio'" :aria-checked="on(o)" :class="{ on: on(o) }" @click="pick(o)">
      <span v-if="o.icon" class="oi"><Icon :name="o.icon" :size="compact ? 16 : 18" /></span>
      <span class="ol"><span class="t">{{ o.label }}</span><small v-if="o.hint && !compact">{{ o.hint }}</small></span>
    </button>
  </div>
</template>

<style scoped>
.ct { display: grid; gap: 8px; }
.ct button {
  display: flex; align-items: center; gap: 10px; min-width: 0; min-height: var(--lmh); padding: 8px 12px;
  border: 1px solid var(--ol); border-radius: var(--r-md); background: var(--s1); color: var(--tx);
  font: inherit; font-size: var(--fs); text-align: start; cursor: pointer;
  transition: background .15s, border-color .15s, color .15s, transform .15s;
}
.ct button:hover { border-color: color-mix(in srgb, var(--acc) 45%, var(--ol)); }
.ct button:active { transform: scale(.98); }
.ct button:focus-visible { outline: 2px solid var(--acc); outline-offset: 1px; }
/* the chosen tile: an accent ring and tint, strong enough to read at a glance in either theme */
.ct button.on { border-color: var(--acc); background: color-mix(in srgb, var(--acc) 10%, var(--s1)); box-shadow: inset 0 0 0 1px var(--acc); }
.oi { flex: none; width: 32px; height: 32px; border-radius: var(--r-sm); display: grid; place-items: center; background: var(--s2); color: var(--tx2); transition: background .15s, color .15s; }
.on .oi { background: var(--acc); color: var(--on); }
.ol { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.t { font-weight: 600; line-height: 1.25; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ol small { font-size: var(--fs-sm); color: var(--tx2); line-height: 1.3; }
/* compact: short labels, centred, a little lower; the icon (if any) loses its box */
.cmp button { justify-content: center; gap: 6px; min-height: 40px; padding: 6px 8px; font-size: var(--fs-sm); }
.cmp .oi { width: auto; height: auto; background: none; }
.cmp .on .oi { background: none; color: var(--acc); }
.cmp .t { font-weight: 500; }
.cmp .on .t { font-weight: 600; }
/* several at once: chosen tiles fill, as ticked boxes do, so a grid of them shows the selection as a whole */
.multi button.on { background: var(--accc); color: var(--onc); border-color: transparent; box-shadow: none; }
</style>
