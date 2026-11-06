<script setup lang="ts">
// Questions that open and close; each answer keeps its tappable citations.
import { computed, ref } from "vue";
import { articles } from "@somnium/knowledge/content";
import { faqItems } from "@somnium/knowledge/learn";
import LearnBlocks from "./LearnBlocks.vue";
import SourceSheet from "./SourceSheet.vue";
import Collapse from "../Collapse.vue";
const items = computed(() => faqItems(articles.find((a) => a.id === "faq/faq")?.body ?? ""));
const openIdx = ref<number | null>(null);
const open = ref<string[] | null>(null);
</script>

<template>
  <div class="art">
    <h1>Frequently asked questions</h1>
    <p class="lede">Short answers to the questions people ask most.</p>
    <div class="faq">
      <div v-for="(q, i) in items" :key="i" class="fq" :class="{ on: openIdx === i }">
        <button type="button" class="fqh" :aria-expanded="openIdx === i" @click="openIdx = openIdx === i ? null : i">{{ q.question }}<span class="fqc" aria-hidden="true" /></button>
        <Collapse :open="openIdx === i"><LearnBlocks :blocks="q.answer" @cite="open = $event" /></Collapse>
      </div>
    </div>
    <SourceSheet v-if="open" :ids="open" @close="open = null" />
  </div>
</template>
