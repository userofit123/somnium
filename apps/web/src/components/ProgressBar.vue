<script setup lang="ts">
// The one progress bar (.pbar in app.css) for Learn, Train, Home, Insights and the updater, so the same meaning always
// looks the same. Pass `label` when the bar stands alone (it becomes a progressbar for screen readers); without it the
// numbers beside the bar carry the meaning and the bar is hidden from them. `muted` is the grey variant for "without".
const props = defineProps<{ percent: number; label?: string; muted?: boolean }>();
const clamped = () => Math.max(0, Math.min(100, props.percent));
</script>

<template>
  <div
    class="pbar"
    :class="{ muted }"
    :role="label ? 'progressbar' : undefined"
    :aria-label="label"
    :aria-valuenow="label ? Math.round(clamped()) : undefined"
    :aria-valuemin="label ? 0 : undefined"
    :aria-valuemax="label ? 100 : undefined"
    :aria-hidden="label ? undefined : true"
  ><i :style="{ width: clamped() + '%' }" /></div>
</template>
