<script setup lang="ts">
// A progress ring (weekly goal, rest timer).
const props = defineProps<{ pct: number; size?: number; stroke?: number; color?: string }>();
const S = props.size ?? 44, W = props.stroke ?? 5, R = (S - W) / 2, C = 2 * Math.PI * R;
</script>

<template>
  <svg class="ring" :width="S" :height="S" :viewBox="`0 0 ${S} ${S}`" style="transform:rotate(-90deg)">
    <circle :cx="S / 2" :cy="S / 2" :r="R" fill="none" stroke="var(--s2)" :stroke-width="W" />
    <circle :cx="S / 2" :cy="S / 2" :r="R" fill="none" :stroke="color ?? 'var(--acc)'" :stroke-width="W" stroke-linecap="round" :stroke-dasharray="C" :stroke-dashoffset="C * (1 - Math.max(0, Math.min(1, pct)))" style="transition:stroke-dashoffset .5s" />
  </svg>
</template>
