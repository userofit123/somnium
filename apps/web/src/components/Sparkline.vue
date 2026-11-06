<script setup lang="ts">
// The small trend line at the bottom of a stat card (as on Money Manager's home page).
import { computed } from "vue";
const props = defineProps<{ values: number[]; color?: string }>();
const uid = Math.random().toString(36).slice(2);
const pts = computed(() => {
  const v = props.values.length > 1 ? props.values : [0, ...(props.values.length ? props.values : [0])];
  const max = Math.max(...v), min = Math.min(...v), span = max - min || 1;
  return v.map((x, i) => [(i / (v.length - 1)) * 200, 42 - ((x - min) / span) * 34] as const);
});
const line = computed(() => pts.value.map((p) => p.join(",")).join(" "));
const area = computed(() => `0,46 ${line.value} 200,46`);
</script>

<template>
  <svg v-if="values.some((v) => v)" class="spark" viewBox="0 0 200 46" preserveAspectRatio="none" aria-hidden="true">
    <defs><linearGradient :id="'sg' + uid" x1="0" y1="0" x2="0" y2="1"><stop offset="0" :stop-color="color ?? 'var(--acc)'" stop-opacity=".45" /><stop offset="1" :stop-color="color ?? 'var(--acc)'" stop-opacity="0" /></linearGradient></defs>
    <polygon :points="area" :fill="`url(#sg${uid})`" />
    <polyline :points="line" fill="none" :stroke="color ?? 'var(--acc)'" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round" />
  </svg>
</template>
