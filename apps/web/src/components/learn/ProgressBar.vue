<script setup lang="ts">
// The shared progress bar (.pbar in app.css); the numbers beside it carry the meaning, so it is hidden from screen readers.
defineProps<{ percent: number }>();
</script>

<template>
  <div class="pbar" aria-hidden="true"><i :style="{ width: percent + '%' }" /></div>
</template>
