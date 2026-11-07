<script setup lang="ts">
// A thin progress bar from theme tokens; the numbers beside it carry the meaning, so it is hidden from screen readers.
defineProps<{ percent: number }>();
</script>

<template>
  <div class="pbar" aria-hidden="true"><div class="pfill" :style="{ width: percent + '%' }" /></div>
</template>
