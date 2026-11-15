<script setup lang="ts">
// The citation chips after a sentence outside an article (For you, Insights, the dream editor): one chip per source id,
// the same look as an inline citation (LDJ-170). A tap asks the page to open that source's sheet.
defineProps<{ ids: readonly string[] }>();
const emit = defineEmits<{ cite: [ids: string[]] }>();
</script>

<template>
  <button v-for="id in ids" :key="id" type="button" class="cite" :aria-label="'Source ' + id" @click="emit('cite', [id])">{{ id }}</button>
</template>
