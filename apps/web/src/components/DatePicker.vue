<script setup lang="ts">
// The app's own date field, in place of <input type="date"> (whose calendar is the browser's): shows the date as set in
// Settings → Units & formats and opens a month like the History calendar, starting on the week's first day from Settings.
// The value stays "YYYY-MM-DD" ("" when empty), as the browser's field gave it.
// Keys while open: arrows move a day or a week, Page Up/Down a month, Enter picks, Esc closes.
import { computed, ref } from "vue";
import { useFmt, localYmd } from "../core/format";
import { isPhone } from "../core/device";
import Icon from "./Icon.vue";
import PickerPop from "./PickerPop.vue";

defineOptions({ inheritAttrs: false });
const props = defineProps<{ modelValue: string | null | undefined; min?: string; max?: string; clearable?: boolean; placeholder?: string; disabled?: boolean; title?: string }>();
const emit = defineEmits<{ "update:modelValue": [v: string]; change: [v: string] }>();
const fmt = useFmt();

const parse = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(y!, m! - 1, d!); };
const valid = (s: string | null | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
// "2026-12-31" written as the person likes dates; the ymd setting already is this form
const label = computed(() => (!valid(props.modelValue) ? "" : fmt.value.s.dateFormat === "ymd" ? props.modelValue : fmt.value.date(props.modelValue, { day: "numeric", month: "short", year: "numeric" })));
const allowed = (s: string) => (!props.min || s >= props.min) && (!props.max || s <= props.max);

const open = ref(false), btn = ref<HTMLButtonElement | null>(null);
const month = ref(new Date()), hi = ref("");
const today = ref(localYmd(new Date()));
const first = computed(() => fmt.value.s.firstDay);
const DOW = computed(() => Array.from({ length: 7 }, (_, i) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][(i + first.value) % 7]!));
// the weeks this month touches, as on the History calendar
const grid = computed(() => {
  const m = month.value, start = new Date(m);
  const lead = (m.getDay() - first.value + 7) % 7;
  start.setDate(1 - lead);
  const cells = Math.ceil((lead + new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate()) / 7) * 7;
  return Array.from({ length: cells }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return { ymd: localYmd(d), n: d.getDate(), out: d.getMonth() !== m.getMonth() }; });
});
const title = computed(() => month.value.toLocaleDateString(undefined, { month: "long", year: "numeric" }));
const pop = ref<InstanceType<typeof PickerPop> | null>(null);
function goTo(s: string) {
  hi.value = s;
  const d = parse(s);
  if (d.getFullYear() !== month.value.getFullYear() || d.getMonth() !== month.value.getMonth()) { month.value = new Date(d.getFullYear(), d.getMonth(), 1); requestAnimationFrame(() => pop.value?.place()); }
}
const shiftMonth = (n: number) => { month.value = new Date(month.value.getFullYear(), month.value.getMonth() + n, 1); requestAnimationFrame(() => pop.value?.place()); };

function show() {
  if (props.disabled || open.value) return;
  today.value = localYmd(new Date());
  const s = valid(props.modelValue) ? props.modelValue : today.value;
  month.value = new Date(parse(s).getFullYear(), parse(s).getMonth(), 1); hi.value = s;
  open.value = true;
}
function close(refocus = true) { open.value = false; if (refocus && !isPhone.value) btn.value?.focus({ preventScroll: true }); }
function pick(s: string) {
  if (s && !allowed(s)) return;
  close();
  if (s !== (props.modelValue ?? "")) { emit("update:modelValue", s); emit("change", s); }
}
function key(e: KeyboardEvent) {
  if (e.key === "Escape") { if (open.value) { e.preventDefault(); e.stopPropagation(); close(); } return; }
  if (e.key === "Tab") { open.value = false; return; }
  if (!open.value) { if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) { e.preventDefault(); show(); } return; }
  const d = parse(hi.value);
  const by: Record<string, () => void> = {
    ArrowLeft: () => d.setDate(d.getDate() - 1), ArrowRight: () => d.setDate(d.getDate() + 1),
    ArrowUp: () => d.setDate(d.getDate() - 7), ArrowDown: () => d.setDate(d.getDate() + 7),
    PageUp: () => d.setMonth(d.getMonth() - 1), PageDown: () => d.setMonth(d.getMonth() + 1),
  };
  if (by[e.key]) { e.preventDefault(); by[e.key]!(); goTo(localYmd(d)); }
  else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(hi.value); }
}
</script>

<template>
  <button ref="btn" type="button" class="fpick" v-bind="$attrs" aria-haspopup="dialog" :aria-expanded="open" :disabled="disabled" @click="open ? close() : show()" @keydown="key">
    <span class="v" :class="{ unset: !label }">{{ label || placeholder || "Choose a day" }}</span><Icon name="calendar" :size="16" />
  </button>
  <PickerPop v-if="open" ref="pop" :anchor="btn" :title="props.title ?? 'Choose a day'" @close="close(false)">
    <div class="dp">
      <div class="dpn">
        <button type="button" class="ib sm plain" aria-label="Previous month" @click="shiftMonth(-1)"><Icon name="left" :size="18" /></button>
        <b aria-live="polite">{{ title }}</b>
        <button type="button" class="ib sm plain" aria-label="Next month" @click="shiftMonth(1)"><Icon name="right" :size="18" /></button>
      </div>
      <div class="dpg">
        <div v-for="d in DOW" :key="d" class="dh" aria-hidden="true">{{ d.slice(0, 2) }}</div>
        <button v-for="c in grid" :key="c.ymd" type="button" class="d" :class="{ out: c.out, today: c.ymd === today, sel: c.ymd === modelValue, hi: c.ymd === hi }"
          :disabled="!allowed(c.ymd)" :aria-label="fmt.dateLong(c.ymd)" :aria-pressed="c.ymd === modelValue" :aria-current="c.ymd === today ? 'date' : undefined" @click="pick(c.ymd)">{{ c.n }}</button>
      </div>
      <div class="dpf">
        <button v-if="allowed(today)" type="button" class="qb acc" @click="pick(today)">Today</button>
        <button v-if="clearable && modelValue" type="button" class="qb" @click="pick('')">Clear</button>
      </div>
    </div>
  </PickerPop>
</template>

<style scoped>
.dp { width: 280px; padding: 2px; }
.sh_b .dp { width: auto; padding: 0 0 4px; }
.dpn { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.dpn b { flex: 1; text-align: center; font-size: var(--fs); font-weight: 600; }
.dpg { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 2px; }
.dh { font-size: var(--fs-xs); font-weight: 600; color: var(--tx2); text-transform: uppercase; letter-spacing: .6px; text-align: center; padding: 2px 0 4px; }
.d { aspect-ratio: 1; min-height: 34px; border: 1px solid transparent; border-radius: 50%; background: none; color: var(--tx); font: inherit; font-size: var(--fs-sm); font-weight: 600; cursor: pointer; display: grid; place-items: center; transition: background .15s, color .15s; }
.sh_b .d { font-size: var(--fs); max-height: 48px; justify-self: center; width: 100%; max-width: 48px; }
.d:hover, .d.hi { background: var(--s2); }
.d.out { opacity: .4; }
.d.today { border-color: var(--acc); color: var(--acc); }
.d.sel { background: var(--acc); color: var(--on); }
.d:disabled { opacity: .25; cursor: not-allowed; background: none; }
.dpf { display: flex; justify-content: space-between; margin-top: 6px; min-height: 8px; }
@media (prefers-reduced-motion: reduce) { .d { transition: none; } }
</style>
