<script setup lang="ts">
// Tonight's plan: the techniques saved into tonight's night. Guided modes come later (LDJ-25); for now a list.
import { computed } from "vue";
import { articles } from "@somnium/knowledge/content";
import { findTechnique } from "@somnium/knowledge/techniques";
import { planTonight } from "../../api/train";
import { useChange } from "../../api/queries";
import Icon from "../Icon.vue";
const props = defineProps<{ planned: string[] }>();
const rows = computed(() => props.planned.map((id) => {
  const t = findTechnique(id);
  return { id, title: (t && articles.find((a) => a.id === "techniques/" + t.slug)?.title) ?? id.replace(/-/g, " ") };
}));
const remove = useChange((id: string) => planTonight(id, false), ["journal", "train"]);
</script>

<template>
  <section class="ttonight">
    <div class="sh"><h2>Tonight's plan</h2></div>
    <div v-if="!rows.length" class="card empty sm"><span class="tiny">Nothing planned yet. Open a technique and choose Use tonight.</span></div>
    <div v-else class="card flush">
      <div v-for="r in rows" :key="r.id" class="li">
        <Icon name="moon" :size="18" />
        <router-link :to="{ path: '/train', query: { technique: r.id } }" class="grow t tname">{{ r.title }}</router-link>
        <button type="button" class="cx" :aria-label="'Remove ' + r.title" :disabled="remove.busy.value" @click="remove.run(r.id)"><Icon name="close" :size="16" /></button>
      </div>
    </div>
  </section>
</template>
