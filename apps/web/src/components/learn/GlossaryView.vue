<script setup lang="ts">
// Terms in alphabetical order with a jump bar of the letters that have terms.
import { computed, ref } from "vue";
import { articles } from "@somnium/knowledge/content";
import { glossaryTerms } from "@somnium/knowledge/learn";
import LearnInline from "./LearnInline.vue";
import SourceSheet from "./SourceSheet.vue";
const terms = computed(() => glossaryTerms(articles.find((a) => a.id === "glossary/glossary")?.body ?? ""));
const letters = computed(() => [...new Set(terms.value.map((t) => t.letter))]);
const open = ref<string[] | null>(null);
const jump = (l: string) => document.getElementById("gl-" + l)?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
const first = (i: number) => i === 0 || terms.value[i - 1]!.letter !== terms.value[i]!.letter;
</script>

<template>
  <div class="art">
    <h1>Glossary</h1>
    <p class="lede">Short definitions of the terms used in this app.</p>
    <div class="jump" role="navigation" aria-label="Jump to a letter"><button v-for="l in letters" :key="l" type="button" @click="jump(l)">{{ l }}</button></div>
    <dl class="lgl">
      <template v-for="(t, i) in terms" :key="t.term">
        <div v-if="first(i)" :id="'gl-' + t.letter" class="glh">{{ t.letter }}</div>
        <dt>{{ t.term }}</dt>
        <dd><LearnInline :nodes="t.definition" @cite="open = $event" /></dd>
      </template>
    </dl>
    <SourceSheet v-if="open" :ids="open" @close="open = null" />
  </div>
</template>
