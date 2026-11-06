<script setup lang="ts">
// One evidence line with its sources ([D13] and the like open the source sheet), in the guided screens' quiet style.
import { computed } from "vue";
import { parseInline } from "@somnium/knowledge/markdown";
import LearnInline from "../../learn/LearnInline.vue";
const props = defineProps<{ text: string; big?: boolean }>();
const emit = defineEmits<{ cite: [ids: string[]] }>();
const nodes = computed(() => parseInline(props.text));
</script>

<template>
  <p :class="big ? 'gp' : 'gev'"><LearnInline :nodes="nodes" @cite="emit('cite', $event)" /></p>
</template>
