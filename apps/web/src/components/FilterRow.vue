<script setup lang="ts">
// One labelled row of chips inside a FilterPanel. With `all`, the first chip clears the row and tapping the picked chip again
// goes back to it; without, exactly one option is always on (a status or a sort). Scrolls sideways on phones.
import Icon from "./Icon.vue";

export interface FilterOption { value: string; label: string; icon?: string; count?: number }
const props = defineProps<{ label: string; options?: FilterOption[]; all?: string; modelValue?: string }>();
const emit = defineEmits<{ "update:modelValue": [v: string] }>();
const pick = (v: string) => emit("update:modelValue", props.all != null && props.modelValue === v ? "" : v);
</script>

<template>
  <div>
    <div class="flbl">{{ label }}</div>
    <div class="chips hscroll">
      <button v-if="all != null" class="fchip" :class="{ on: !modelValue }" @click="emit('update:modelValue', '')">{{ all }}</button>
      <slot>
        <button v-for="o in options" :key="o.value" class="fchip" :class="{ on: modelValue === o.value }" @click="pick(o.value)">
          <Icon v-if="o.icon" :name="o.icon" :size="14" />{{ o.label }}<span v-if="o.count != null" class="n">{{ o.count }}</span>
        </button>
      </slot>
    </div>
  </div>
</template>

<style scoped>
.flbl { margin-bottom: 6px; }
/* chips run to the panel's edge while scrolling on phones; on wider screens they wrap */
.chips.hscroll { margin-inline: calc(4px - var(--cpx)); padding-inline: calc(var(--cpx) - 4px); }
html:not(.phone) .chips.hscroll { margin-inline: 0; padding-inline: 0; }
.fchip, :slotted(.fchip) { background: var(--s1); }
.fchip.on, :slotted(.fchip.on) { background: var(--accc); }
.n { opacity: .65; font-variant-numeric: tabular-nums; margin-inline-start: 2px; }
</style>
