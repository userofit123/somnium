<script setup lang="ts">
// The one slide-open section: only this container's height animates, never the items inside it.
// The content stays mounted while it slides shut, then is removed (cheap when closed, and out of the tab order).
import { nextTick, ref, watch } from "vue";
const props = defineProps<{ open: boolean }>();
const mounted = ref(props.open);
const on = ref(props.open);
// fully open and still: the clip is lifted so a hovered card's raise, outline and glow are not cut off at the edge
const settled = ref(props.open);
const el = ref<HTMLElement>();
const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
watch(() => props.open, async (o) => {
  settled.value = false;
  if (o) { mounted.value = true; await nextTick(); void el.value?.offsetHeight; on.value = true; if (still()) settled.value = true; }
  else { on.value = false; if (still()) mounted.value = false; }
});
function done(e: TransitionEvent) {
  if (e.target !== el.value) return;
  if (on.value) settled.value = true; else mounted.value = false;
}
</script>

<template>
  <div ref="el" class="clp" :class="{ on, settled }" :inert="!on" @transitionend="done">
    <div class="clpi"><slot v-if="mounted" /></div>
  </div>
</template>
