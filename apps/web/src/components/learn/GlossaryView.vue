<script setup lang="ts">
// Terms in alphabetical order with a jump bar of the letters that have terms.
import { computed, onMounted, ref, nextTick } from "vue";
import { useRoute } from "vue-router";
import { articles } from "@somnium/knowledge/content";
import { glossaryTerms, pinId, slug } from "@somnium/knowledge/learn";
import { useLearn, useReadAtEnd } from "../../core/learn";
import PinButton from "./PinButton.vue";
import LearnInline from "./LearnInline.vue";
import SourceSheet from "./SourceSheet.vue";
const terms = computed(() => glossaryTerms(articles.find((a) => a.id === "glossary/glossary")?.body ?? ""));
const letters = computed(() => [...new Set(terms.value.map((t) => t.letter))]);
const open = ref<string[] | null>(null);
const route = useRoute();
const { read } = useLearn();
const { end } = useReadAtEnd(() => "glossary/glossary", read);
// a pinned term opens the glossary scrolled to it
onMounted(async () => { await nextTick(); const t = String(route.query.term ?? ""); if (t) document.getElementById("t-" + t)?.scrollIntoView({ block: "center" }); });
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
        <dt :id="'t-' + slug(t.term)" class="gterm"><span>{{ t.term }}</span><PinButton :id="pinId.term(t.term)" :label="t.term" /></dt>
        <dd><LearnInline :nodes="t.definition" @cite="open = $event" /></dd>
      </template>
    </dl>
    <div ref="end" class="endmark" aria-hidden="true" />
    <SourceSheet v-if="open" :ids="open" @close="open = null" />
  </div>
</template>
