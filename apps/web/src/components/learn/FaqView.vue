<script setup lang="ts">
// Questions that open and close; each answer keeps its tappable citations.
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { articles } from "@somnium/knowledge/content";
import { faqItems, pinId, slug } from "@somnium/knowledge/learn";
import { useLearn, useReadAtEnd } from "../../core/learn";
import PinButton from "./PinButton.vue";
import LearnBlocks from "./LearnBlocks.vue";
import SourceSheet from "./SourceSheet.vue";
import Collapse from "../Collapse.vue";
const items = computed(() => faqItems(articles.find((a) => a.id === "faq/faq")?.body ?? ""));
const openIdx = ref<number | null>(null);
const route = useRoute();
const { read } = useLearn();
const { end } = useReadAtEnd(() => "faq/faq", read);
// a pinned question opens in place
onMounted(() => { const q = String(route.query.item ?? ""); const i = items.value.findIndex((x) => slug(x.question) === q); if (i >= 0) openIdx.value = i; });
const open = ref<string[] | null>(null);
</script>

<template>
  <div class="art">
    <h1>Frequently asked questions</h1>
    <p class="lede">Short answers to the questions people ask most.</p>
    <div class="faq">
      <div v-for="(q, i) in items" :key="i" class="fq" :class="{ on: openIdx === i }">
        <div class="fqrow"><button type="button" class="fqh" :aria-expanded="openIdx === i" @click="openIdx = openIdx === i ? null : i">{{ q.question }}<span class="fqc" aria-hidden="true" /></button><PinButton :id="pinId.faq(q.question)" :label="q.question" /></div>
        <Collapse :open="openIdx === i"><LearnBlocks :blocks="q.answer" @cite="open = $event" /></Collapse>
      </div>
    </div>
    <div ref="end" class="endmark" aria-hidden="true" />
    <SourceSheet v-if="open" :ids="open" @close="open = null" />
  </div>
</template>
