<script setup lang="ts">
import { toasts } from "../core/toast";
</script>

<template>
  <div class="tst" aria-live="polite">
    <div v-for="t in toasts" :key="t.id" :class="t.kind">
      <span>{{ t.text }}</span>
      <button v-if="t.action" @click="t.action.run(); toasts.splice(toasts.indexOf(t), 1)">{{ t.action.label }}</button>
    </div>
  </div>
</template>
