<script setup lang="ts">
// A line chart over time with a soft area, gridlines and a tooltip; points can be clicked (e.g. to open that night).
import { computed, ref } from "vue";
import { useWidth } from "./useWidth";

const props = defineProps<{ points: { x: number; y: number; label?: string; id?: string }[]; height?: number; fmt?: (v: number) => string; xfmt?: (t: number) => string; color?: string; zero?: boolean }>();
const emit = defineEmits<{ pick: [id: string] }>();
const box = ref<HTMLElement | null>(null);
const W = useWidth(box), H = computed(() => props.height ?? 200), P = { l: 44, r: 12, t: 10, b: 22 };
const uid = Math.random().toString(36).slice(2);
const sorted = computed(() => [...props.points].sort((a, b) => a.x - b.x));
const dom = computed(() => {
  const ys = sorted.value.map((p) => p.y), xs = sorted.value.map((p) => p.x);
  let lo = props.zero ? 0 : Math.min(...ys), hi = Math.max(...ys);
  const flat = lo === hi;
  if (flat) { const m = Math.abs(hi) * 0.1 || 1; lo -= m; hi += m; }
  const pad = (hi - lo) * 0.1;
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: props.zero ? 0 : lo - pad, y1: hi + pad, flat };
});
const sx = (x: number) => { const d = dom.value; return P.l + (d.x1 === d.x0 ? 0.5 : (x - d.x0) / (d.x1 - d.x0)) * (W.value - P.l - P.r); };
const sy = (y: number) => { const d = dom.value; return P.t + (1 - (y - d.y0) / (d.y1 - d.y0)) * (H.value - P.t - P.b); };
const path = computed(() => sorted.value.map((p, i) => `${i ? "L" : "M"}${sx(p.x)},${sy(p.y)}`).join(""));
const area = computed(() => sorted.value.length ? `${path.value}L${sx(sorted.value.at(-1)!.x)},${H.value - P.b}L${sx(sorted.value[0]!.x)},${H.value - P.b}Z` : "");
// three gridlines, unless the labels would repeat (flat or tiny ranges), then one per distinct label
const ticks = computed(() => { const d = dom.value; if (d.flat) return [sorted.value[0]!.y]; const t = [0, 0.5, 1].map((k) => d.y0 + (d.y1 - d.y0) * k); return t.filter((v, i) => t.findIndex((u) => f(u) === f(v)) === i); });
const xticks = computed(() => { const s = sorted.value; if (s.length < 2) return s.map((p) => p.x); return [s[0]!.x, s[Math.floor(s.length / 2)]!.x, s.at(-1)!.x]; });
const hover = ref<number | null>(null);
function move(e: MouseEvent) {
  const r = (e.currentTarget as SVGElement).getBoundingClientRect();
  const x = ((e.clientX - r.left) / r.width) * W.value;
  let best = 0, bd = Infinity;
  sorted.value.forEach((p, i) => { const d = Math.abs(sx(p.x) - x); if (d < bd) { bd = d; best = i; } });
  hover.value = best;
}
const f = (v: number) => (props.fmt ? props.fmt(v) : String(Math.round(v * 10) / 10));
const xf = (t: number) => (props.xfmt ? props.xfmt(t) : new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" }));
</script>

<template>
  <div ref="box" style="position:relative">
    <div v-if="!points.length" class="empty" style="padding:calc(var(--cpy) * 2) 0">No data yet</div>
    <svg v-else class="chart" :viewBox="`0 0 ${W} ${H}`" :style="{ height: H + 'px' }" @mousemove="move" @mouseleave="hover = null"
      @click="hover != null && sorted[hover]?.id && emit('pick', sorted[hover]!.id!)">
      <defs><linearGradient :id="'cg' + uid" x1="0" y1="0" x2="0" y2="1"><stop offset="0" :stop-color="color ?? 'var(--acc)'" stop-opacity=".35" /><stop offset="1" :stop-color="color ?? 'var(--acc)'" stop-opacity="0" /></linearGradient></defs>
      <g v-for="t in ticks" :key="t"><line class="gl" :x1="P.l" :x2="W - P.r" :y1="sy(t)" :y2="sy(t)" /><text class="ax" :x="P.l - 6" :y="sy(t) + 3" text-anchor="end">{{ f(t) }}</text></g>
      <text v-for="(t, i) in xticks" :key="'x' + i" class="ax" :x="sx(t)" :y="H - 4" :text-anchor="i === 0 ? 'start' : i === xticks.length - 1 ? 'end' : 'middle'">{{ xf(t) }}</text>
      <path :d="area" :fill="`url(#cg${uid})`" />
      <path class="ln" :d="path" :style="color ? { stroke: color } : undefined" />
      <circle v-for="(p, i) in sorted" :key="i" class="pt" :cx="sx(p.x)" :cy="sy(p.y)" :r="hover === i ? 5 : sorted.length > 40 ? 0 : 3" :style="color ? { stroke: color } : undefined" />
    </svg>
    <div v-if="hover != null && sorted[hover]" class="ctip" :style="{ left: (sx(sorted[hover]!.x) / W) * 100 + '%', top: (sy(sorted[hover]!.y) / H) * 100 + '%' }">
      <b>{{ f(sorted[hover]!.y) }}</b> · {{ sorted[hover]!.label ?? xf(sorted[hover]!.x) }}
    </div>
  </div>
</template>
