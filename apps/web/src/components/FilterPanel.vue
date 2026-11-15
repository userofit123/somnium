<script setup lang="ts">
// The filter block above a list (for the journal list and pickers): a shaded panel of labelled chip rows (FilterRow),
// then how many match and "Clear filters" once anything is narrowed, so every list filters the same way.
defineProps<{ count?: string; active?: boolean }>();
const emit = defineEmits<{ clear: [] }>();
</script>

<template>
  <div class="fpanel">
    <div class="fbox"><slot /></div>
    <div v-if="count || active" class="row ffoot">
      <span class="tiny grow">{{ count }}</span>
      <button v-if="active" class="btn tonal s" @click="emit('clear')">Clear filters</button>
    </div>
  </div>
</template>

<style scoped>
/* sits --hg above the list it filters, like a heading; inside, a smaller card padding (FilterRow bleeds its chips to it) */
.fpanel { margin-bottom: var(--hg); }
.fbox { display: flex; flex-direction: column; gap: var(--hg); padding: calc(var(--cpy) - 3px) calc(var(--cpx) - 4px); border-radius: var(--r-md); background: var(--s2); }
.ffoot { margin: 2px 0 0; min-height: 28px; }

</style>
