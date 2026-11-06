<script setup lang="ts">
// The techniques library (LDJ-23): every technique article by family, each with its evidence badge.
import { computed } from "vue";
import { articles } from "@somnium/knowledge/content";
import { families, inFamily, evidenceLabel } from "@somnium/knowledge/techniques";
const props = defineProps<{ planned: string[] }>();
const byFamily = computed(() => families.map((f) => ({
  ...f,
  items: inFamily(f.id).map((t) => ({ ...t, article: articles.find((a) => a.id === "techniques/" + t.slug)!, planned: props.planned.includes(t.id) })),
})));
</script>

<template>
  <section v-for="f in byFamily" :key="f.id" class="tfam">
    <div class="sh"><h2>{{ f.title }}</h2></div>
    <div class="card flush">
      <router-link v-for="t in f.items" :key="t.id" :to="{ path: '/train', query: { technique: t.id } }" class="li click tlink">
        <div class="grow">
          <div class="t">{{ t.article.title }}</div>
          <div class="tiny tsum">{{ t.article.summary }}</div>
        </div>
        <div class="tside">
          <span class="tev" :class="t.evidence">{{ evidenceLabel[t.evidence] }}</span>
          <span v-if="t.planned" class="tiny">Tonight</span>
        </div>
      </router-link>
    </div>
  </section>
</template>
