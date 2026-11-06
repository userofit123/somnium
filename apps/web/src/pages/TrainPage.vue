<script setup lang="ts">
// Train (PLAN.md §6): a placeholder until its own task builds it. The same page serves both layouts. Logging a reality
// check done without a reminder is here already (LDJ-28): the same /check screen a reminder opens, not prompted.
import { useRouter } from "vue-router";
const router = useRouter();
</script>

<template>
  <div class="page">
    <div class="ph"><div><h1>Train</h1></div><div class="acts"><button class="btn" @click="router.push('/check')">Log a check</button></div></div>
    <div class="card empty"><b>Train</b>The course, the techniques and your practice for today.</div>
  </div>
</template>
