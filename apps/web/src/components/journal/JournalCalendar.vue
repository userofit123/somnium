<script setup lang="ts">
// The Journal's month (the calendar idea from Motus's history): a dot per dream, lucid ones in the accent colour,
// a ring for a night logged with no recall. Picking a day shows its nights below (JournalPage).
import { computed } from "vue";
import { monthGrid, shiftMonth, type DayMark } from "@somnium/shared";
import { localYmd, useFmt } from "../../core/format";
import Icon from "../Icon.vue";

const props = defineProps<{ month: string; marks: Map<string, DayMark>; selected: string }>();
const emit = defineEmits<{ "update:month": [m: string]; pick: [d: string] }>();
const fmt = useFmt();
const today = localYmd(new Date());
const days = computed(() => { const [y, m] = props.month.split("-").map(Number) as [number, number]; return monthGrid(y, m, fmt.value.s.firstDay ?? 1); });
const DOW = computed(() => Array.from({ length: 7 }, (_, i) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][(i + (fmt.value.s.firstDay ?? 1)) % 7]!));
const title = computed(() => fmt.value.date(props.month + "-15", { month: "long", year: "numeric" }));
const dots = (d: string) => { const m = props.marks.get(d); return m ? [...Array(Math.min(m.lucid, 4)).fill("l"), ...Array(Math.min(m.other, 4 - Math.min(m.lucid, 4))).fill("o")] : []; };
let x0 = 0;
</script>

<template>
  <div class="calnav">
    <button class="ib sm plain" aria-label="Previous month" @click="emit('update:month', shiftMonth(month, -1))"><Icon name="left" :size="18" /></button>
    <b>{{ title }}</b>
    <button class="ib sm plain" aria-label="Next month" @click="emit('update:month', shiftMonth(month, 1))"><Icon name="right" :size="18" /></button>
    <div class="grow" />
    <button v-if="month !== today.slice(0, 7)" class="fchip acc" @click="emit('update:month', today.slice(0, 7)); emit('pick', today)">Today</button>
  </div>
  <div class="cal jcal" @touchstart.passive="(e) => (x0 = e.touches[0]!.clientX)" @touchend.passive="(e) => { const dx = e.changedTouches[0]!.clientX - x0; if (Math.abs(dx) > 60) emit('update:month', shiftMonth(month, dx < 0 ? 1 : -1)); }">
    <div v-for="d in DOW" :key="d" class="dh">{{ d }}</div>
    <button v-for="d in days" :key="d" class="d" :class="{ out: d.slice(0, 7) !== month, today: d === today, sel: selected === d }" :aria-label="fmt.date(d, { day: 'numeric', month: 'long' })" @click="emit('pick', d)">
      <span class="n">{{ Number(d.slice(8)) }}</span>
      <span class="dots"><i v-for="(k, i) in dots(d)" :key="i" :class="k" /><i v-if="marks.get(d)?.noRecall" class="nr" /></span>
    </button>
  </div>
  <div class="tiny jkey"><span><i class="l" />Lucid</span><span><i class="o" />Dream</span><span><i class="nr" />No recall</span></div>
</template>

<style scoped>
.jcal .d { min-height: 64px; align-items: center; font: inherit; color: var(--tx); text-align: center; }
.jcal .d.sel { border-color: var(--acc); }
.dots { display: flex; gap: 3px; justify-content: center; flex-wrap: wrap; min-height: 7px; }
.dots i, .jkey i { width: 7px; height: 7px; border-radius: 50%; display: inline-block; background: var(--tx2); }
.dots i.l, .jkey i.l { background: var(--acc); }
.dots i.nr, .jkey i.nr { background: none; border: 1px solid var(--tx2); }
.jkey { display: flex; gap: var(--hg); margin-top: var(--hg); color: var(--tx2); }
.jkey span { display: inline-flex; align-items: center; gap: 6px; }
</style>
