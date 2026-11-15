<script setup lang="ts">
import type { Ref } from "vue";
import Icon from "./Icon.vue";

// One loading and error state for any block backed by a query. The error says nothing from the failure itself
// (it can carry paths or ids); the cause is in the device log. Pages already wait for data in <Suspense>
// (loaded()), so this covers cards that load later and any query that failed.
defineProps<{
  q: { isLoading: Ref<boolean>; isError: Ref<boolean>; refetch: () => unknown };
  what: string; // "the log", "your journal": completes "Couldn't load ..."
  sm?: boolean;
}>();
</script>

<template>
  <div v-if="q.isLoading.value" class="card skel" :class="{ sm }" role="status" aria-label="Loading" />
  <div v-else-if="q.isError.value" class="card empty" :class="{ sm }" role="alert">
    <Icon name="info" :size="34" /><b>Couldn't load {{ what }}</b>Check your connection and try again. Nothing was lost.<br />
    <button class="btn tonal" type="button" @click="q.refetch()">Retry</button>
  </div>
  <slot v-else />
</template>
