<script setup lang="ts">
// The source behind a citation mark, from the bundled reference lists (RESEARCH.md numbering).
import { computed } from "vue";
import Sheet from "../Sheet.vue";
import LearnInline from "./LearnInline.vue";
import { sources } from "@somnium/knowledge/content";
import { parseInline } from "@somnium/knowledge/markdown";
const props = defineProps<{ ids: string[] }>();
defineEmits<{ close: [] }>();
const partName: Record<string, string> = { A: "History, origins and prevalence", B: "The science and the evidence", C: "Dream content, recall and journaling", D: "Techniques, traditions and training" };
// the address is split off so it can be a real link; the rest keeps its italics
const rows = computed(() => props.ids.map((id) => {
  const text = sources.get(id)?.text ?? "";
  const url = /https?:\/\/\S+/.exec(text)?.[0];
  return { id, part: partName[id[0]!], found: !!text, nodes: parseInline(url ? text.replace(url, "").trim() : text), url };
}));
</script>

<template>
  <Sheet :title="ids.length > 1 ? 'Sources' : 'Source'" @close="$emit('close')">
    <div v-for="r in rows" :key="r.id" class="srcrow">
      <div class="srcid"><b>{{ r.id }}</b> <span class="s">{{ r.part }}</span></div>
      <p v-if="r.found"><LearnInline :nodes="r.nodes" /></p>
      <p v-else>This source is not in the list.</p>
      <a v-if="r.url" :href="r.url" target="_blank" rel="noopener noreferrer" class="srcurl">{{ r.url }}</a>
    </div>
  </Sheet>
</template>
