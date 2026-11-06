<script setup lang="ts">
// The app mark: Somnium's crescent moon with an open eye (public/icon.svg, drawn in one colour), on the accent gradient. Clicking it on the rail picks a random look, as in Money Manager.
import { ref } from "vue";
import { shuffle as doShuffle } from "../core/theme";
const props = defineProps<{ shuffle?: boolean }>();
const el = ref<HTMLElement | null>(null);
const click = () => { if (props.shuffle) doShuffle(el.value); };
</script>

<template>
  <div ref="el" class="logo" :class="{ click: shuffle }" :title="shuffle ? 'Surprise me with a new look' : undefined" @click="click">
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><g transform="translate(.6 -.6)"><path fill-rule="evenodd" d="M11.27 5.25A7.31 7.31 0 1 0 17.99 14.9A5.91 5.91 0 0 1 11.27 5.25ZM5.6 14.6Q8.4 11.64 11.2 14.6Q8.4 17.56 5.6 14.6Z"/><circle cx="8.4" cy="14.6" r="1.2"/><path d="M17.44 7.03l.38 1.03 1.03.38-1.03.38-.38 1.03-.38-1.03-1.03-.38 1.03-.38z"/></g></svg>
  </div>
</template>
