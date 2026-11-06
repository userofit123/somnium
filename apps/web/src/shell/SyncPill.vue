<script setup lang="ts">
// Shown only while the server can't be reached, or while the journal key isn't open (nothing is synced until it
// is): the app keeps working on this device's copy, and says so.
import { sync } from "../api/replica";
import Icon from "../components/Icon.vue";
</script>

<template>
  <Transition name="sp">
    <div v-if="sync.on && (!sync.sealed || !sync.online)" class="syncpill" role="status">
      <Icon name="refresh" :size="14" />{{ sync.sealed ? "Offline" : "Not syncing · locked" }}<template v-if="sync.waiting"> · {{ sync.waiting }} change{{ sync.waiting === 1 ? "" : "s" }} saved here</template>
    </div>
  </Transition>
</template>
