<script setup lang="ts">
// A pin toggle for one Learn item (article, lesson, glossary term or FAQ question). Pins are plain ids in settings.
import { computed } from "vue";
import { useLearn, togglePinned } from "../../core/learn";
import Icon from "../Icon.vue";
const props = defineProps<{ id: string; label?: string }>();
const { pinned } = useLearn();
const on = computed(() => pinned.value.includes(props.id));
</script>

<template>
  <button type="button" class="ib sm plain pinb" :class="{ on }" :aria-pressed="on" :aria-label="(on ? 'Unpin ' : 'Pin ') + (label ?? 'this')" :title="on ? 'Unpin' : 'Pin'" @click.stop.prevent="togglePinned(pinned, id)">
    <Icon name="pin" :size="16" />
  </button>
</template>
