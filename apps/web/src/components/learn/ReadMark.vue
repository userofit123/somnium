<script setup lang="ts">
// The read mark on a list row: a tick and the word, so it does not rest on colour alone.
import Icon from "../Icon.vue";
defineProps<{ done: boolean }>();
</script>

<template>
  <span v-if="done" class="rdm"><Icon name="check" :size="14" /> Read</span>
</template>
