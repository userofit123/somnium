<script setup lang="ts">
// The app's own time field, in place of <input type="time"> (whose clock is the browser's): 12- or 24-hour as set in
// Settings → Units & formats. The value stays "HH:MM" ("" when empty), as the browser's field gave it.
// Keys while open: Up/Down move 5 minutes, Page Up/Down an hour, typing digits sets it ("1830", "730", "18"),
// A/P picks morning or afternoon on a 12-hour clock, Enter or Esc closes.
import { computed, nextTick, ref } from "vue";
import { useFmt } from "../core/format";
import { isPhone } from "../core/device";
import Icon from "./Icon.vue";
import PickerPop from "./PickerPop.vue";

defineOptions({ inheritAttrs: false });
const props = defineProps<{ modelValue: string | null | undefined; clearable?: boolean; placeholder?: string; disabled?: boolean; title?: string }>();
const emit = defineEmits<{ "update:modelValue": [v: string]; change: [v: string] }>();
const fmt = useFmt();
const h12 = computed(() => fmt.value.s.clock === "12");

const p2 = (n: number) => String(n).padStart(2, "0");
const val = computed(() => { const m = /^(\d{1,2}):(\d{2})/.exec(props.modelValue ?? ""); return m ? { h: +m[1]!, m: +m[2]! } : null; });
const show12 = (h: number, m: number) => `${h % 12 || 12}:${p2(m)} ${h < 12 ? "AM" : "PM"}`;
const fmtT = (h: number, m: number) => (h12.value ? show12(h, m) : `${p2(h)}:${p2(m)}`);
const label = computed(() => (val.value ? fmtT(val.value.h, val.value.m) : ""));

const hours = computed(() => (h12.value ? [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] : Array.from({ length: 24 }, (_, i) => i)));
// five-minute steps, plus the value's own minute when it's between them
const minutes = computed(() => { const l = Array.from({ length: 12 }, (_, i) => i * 5), m = val.value?.m; return m != null && m % 5 ? [...l, m].sort((a, b) => a - b) : l; });
const QUICK: [number, number][] = [[7, 0], [12, 0], [17, 0], [18, 0], [19, 0]];

const open = ref(false), btn = ref<HTMLButtonElement | null>(null);
const cols = ref<HTMLElement | null>(null);
// open on the chosen hour and minute, not at the top of the columns
function show() {
  if (props.disabled || open.value) return;
  open.value = true;
  nextTick(() => cols.value?.querySelectorAll<HTMLElement>(".on").forEach((e) => { const c = e.parentElement!; c.scrollTop = e.offsetTop - c.clientHeight / 2 + e.offsetHeight / 2; }));
}
function close(refocus = true) { open.value = false; if (refocus && !isPhone.value) btn.value?.focus({ preventScroll: true }); }
function set(h: number, m: number) {
  const v = `${p2(((h % 24) + 24) % 24)}:${p2(m)}`;
  if (v !== props.modelValue) { emit("update:modelValue", v); emit("change", v); }
}
const now = () => { const d = new Date(), m = Math.round(d.getMinutes() / 5) * 5; return m === 60 ? [d.getHours() + 1, 0] : [d.getHours(), m]; };
// a column picked before there's a value starts from the current hour
const base = () => val.value ?? { h: now()[0]!, m: 0 };
const pickHour = (h: number) => { const b = base(); set(h12.value ? (h % 12) + (b.h >= 12 ? 12 : 0) : h, b.m); };
const pickMin = (m: number) => { set(base().h, m); close(); };
const pickPm = (pm: boolean) => { const b = base(); set((b.h % 12) + (pm ? 12 : 0), b.m); };
const isHour = (h: number) => val.value != null && (h12.value ? val.value.h % 12 === h % 12 : val.value.h === h);

let typed = "", typedAt = 0;
function key(e: KeyboardEvent) {
  if (e.key === "Escape") { if (open.value) { e.preventDefault(); e.stopPropagation(); close(); } return; }
  if (e.key === "Tab") { open.value = false; return; }
  if (!open.value) { if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) { e.preventDefault(); show(); } return; }
  const b = base(), t = b.h * 60 + b.m;
  const by: Record<string, number> = { ArrowUp: 5, ArrowDown: -5, PageUp: 60, PageDown: -60 };
  if (by[e.key]) { e.preventDefault(); const n = (t + by[e.key]! + 1440) % 1440; set(Math.floor(n / 60), n % 60); return; }
  if (e.key === "Enter") { e.preventDefault(); close(); return; }
  if (h12.value && /^[ap]$/i.test(e.key)) { e.preventDefault(); pickPm(e.key.toLowerCase() === "p"); return; }
  if (/^\d$/.test(e.key)) {
    e.preventDefault();
    typed = (Date.now() - typedAt < 1500 ? typed : "") + e.key; typedAt = Date.now();
    if (typed.length > 4) typed = e.key;
    let h = typed.length <= 2 ? +typed : typed.length === 3 ? +typed[0]! : +typed.slice(0, 2), m = typed.length <= 2 ? 0 : +typed.slice(-2);
    if (h > 23 || m > 59) return;
    // on a 12-hour clock "7" keeps the morning or afternoon it had
    if (h12.value && h >= 1 && h <= 12) h = (h % 12) + (b.h >= 12 ? 12 : 0);
    set(h, m);
  }
}
</script>

<template>
  <button ref="btn" type="button" class="fpick" v-bind="$attrs" aria-haspopup="dialog" :aria-expanded="open" :disabled="disabled" @click="open ? close() : show()" @keydown="key">
    <span class="v" :class="{ unset: !label }">{{ label || placeholder || "Choose a time" }}</span><Icon name="clock" :size="16" />
  </button>
  <PickerPop v-if="open" :anchor="btn" :title="title ?? 'Choose a time'" @close="close(false)">
    <div class="tp">
      <div class="tpq">
        <button type="button" class="fchip" @click="set(now()[0]!, now()[1]!); close()">Now</button>
        <button v-for="[h, m] in QUICK" :key="h" type="button" class="fchip" :class="{ on: val?.h === h && val?.m === m }" @click="set(h, m); close()">{{ fmtT(h, m) }}</button>
      </div>
      <div ref="cols" class="tpc" :class="{ three: h12 }">
        <div class="tcol" role="listbox" aria-label="Hour"><button v-for="h in hours" :key="h" type="button" role="option" :aria-selected="isHour(h)" :class="{ on: isHour(h) }" @click="pickHour(h)">{{ h12 ? h : p2(h) }}</button></div>
        <div class="tcol" role="listbox" aria-label="Minute"><button v-for="m in minutes" :key="m" type="button" role="option" :aria-selected="val?.m === m" :class="{ on: val?.m === m }" @click="pickMin(m)">{{ p2(m) }}</button></div>
        <div v-if="h12" class="tcol" role="listbox" aria-label="Morning or afternoon">
          <button type="button" role="option" :aria-selected="val != null && val.h < 12" :class="{ on: val != null && val.h < 12 }" @click="pickPm(false)">AM</button>
          <button type="button" role="option" :aria-selected="val != null && val.h >= 12" :class="{ on: val != null && val.h >= 12 }" @click="pickPm(true)">PM</button>
        </div>
      </div>
      <div v-if="clearable && modelValue" class="tpf"><button type="button" class="qb" @click="emit('update:modelValue', ''); emit('change', ''); close()">No time</button></div>
    </div>
  </PickerPop>
</template>

<style scoped>
.tp { width: 260px; padding: 2px; }
.sh_b .tp { width: auto; padding: 0 0 4px; }
.tpq { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
.tpc { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.tpc.three { grid-template-columns: 1fr 1fr .8fr; }
.tcol { position: relative; display: flex; flex-direction: column; gap: 2px; max-height: 216px; overflow-y: auto; overscroll-behavior: contain; padding: 2px; border-radius: var(--r-sm); background: var(--s1); }
.sh_b .tcol { max-height: 40vh; }
.tcol button { border: 0; background: none; color: var(--tx); font: inherit; font-size: var(--fs); font-variant-numeric: tabular-nums; padding: 7px 0; border-radius: 8px; cursor: pointer; flex: none; transition: background .15s; }
.sh_b .tcol button { padding: 10px 0; font-size: var(--fs-lg); }
.tcol button:hover { background: var(--s2); }
.tcol button.on { background: var(--acc); color: var(--on); font-weight: 600; }
.tpf { display: flex; margin-top: 8px; }
@media (prefers-reduced-motion: reduce) { .tcol button { transition: none; } }
</style>
