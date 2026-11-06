<script setup lang="ts">
// Shown only while the server can't be reached: the app keeps working, and says so.
import { sync } from "../api/replica";
import Icon from "../components/Icon.vue";
</script>

<template>
  <Transition name="sp">
    <div v-if="sync.on && !sync.online" class="syncpill" role="status">
      <Icon name="refresh" :size="14" />Offline<template v-if="sync.waiting"> · {{ sync.waiting }} change{{ sync.waiting === 1 ? "" : "s" }} saved here</template>
    </div>
  </Transition>
</template>
