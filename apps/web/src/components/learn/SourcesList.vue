<script setup lang="ts">
// The Sources block at the end of an article, a lesson or a technique (LDJ-170): one toggle, "Sources (n) · reviewed
// <date>", and the list it opens. A tap on an id asks the page to open its source sheet, like an inline citation.
import { computed, ref, watch } from "vue";
import { sources } from "@somnium/knowledge/content";
const props = defineProps<{ ids: readonly string[]; reviewed: string }>();
const emit = defineEmits<{ cite: [ids: string[]] }>();
// ids missing from the reference lists are left out; the content tests keep that list empty
const listed = computed(() => props.ids.filter((id) => sources.has(id)));
const shown = ref(false);
// a page reused for the next article starts with its sources closed
watch(() => props.ids, () => { shown.value = false; });
const text = (id: string) => sources.get(id)?.text.replace(/https?:\/\/\S+/, "").trim();
</script>

<template>
  <section class="srcs">
    <button type="button" class="srch" :aria-expanded="shown" @click="shown = !shown">
      Sources ({{ listed.length }}) <span class="s">· reviewed {{ reviewed }}</span>
    </button>
    <ul v-if="shown">
      <li v-for="id in listed" :key="id"><button type="button" class="cite" @click="emit('cite', [id])">{{ id }}</button> <span class="s">{{ text(id) }}</span></li>
    </ul>
  </section>
</template>
