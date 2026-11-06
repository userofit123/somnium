<script setup lang="ts" generic="T">
// One choice from a few options that each need a line of explanation, stacked as radio rows: where a note or a
// reminder comes back, how the weight goes up. Short plain choices belong in a .seg or ChoiceTiles.
defineProps<{ modelValue: T; options: { value: T; label: string; hint?: string }[] }>();
const emit = defineEmits<{ "update:modelValue": [v: T] }>();
</script>

<template>
  <div class="opt-list" role="radiogroup">
    <button v-for="(x, i) in options" :key="i" type="button" class="optb sm" :class="{ on: modelValue === x.value }" role="radio" :aria-checked="modelValue === x.value" @click="emit('update:modelValue', x.value)">
      <span class="radio" /><span class="grow"><span class="t">{{ x.label }}</span><span v-if="x.hint" class="s" style="display:block">{{ x.hint }}</span></span>
    </button>
  </div>
</template>

<style scoped>
.optb.sm { padding: calc(var(--cpy) - 5px) calc(var(--cpx) - 4px); gap: 12px; align-items: flex-start; }
.optb.on { border-color: var(--acc); background: color-mix(in srgb, var(--acc) 8%, var(--s1)); }
.radio { width: 18px; height: 18px; border-radius: 50%; border: 2px solid var(--ol); flex: none; margin-top: 2px; }
.optb.on .radio { border-color: var(--acc); box-shadow: inset 0 0 0 3px var(--s1), inset 0 0 0 9px var(--acc); }
</style>
