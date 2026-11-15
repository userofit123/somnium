<script setup lang="ts">
// One technique (LDJ-23): its Learn article rendered with the same renderer and source sheet, the evidence badge and
// where it comes from, the safety note where it applies, and the screen's one primary button: "Use tonight".
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { articles } from "@somnium/knowledge/content";
import { parseMarkdown } from "@somnium/knowledge/markdown";
import { families, type Technique } from "@somnium/knowledge/techniques";
import LearnBlocks from "../learn/LearnBlocks.vue";
import SourceSheet from "../learn/SourceSheet.vue";
import SourcesList from "../learn/SourcesList.vue";
import SafetyNote from "./SafetyNote.vue";
import TechniqueUse from "./TechniqueUse.vue";
import Icon from "../Icon.vue";
import { goBack, backLabel } from "../../core/leave";

const props = defineProps<{ technique: Technique; planned: boolean }>();
// Back returns to where it was opened from (Home's Tonight card, a lesson, Train); opened directly, to the library
const router = useRouter();
const back = backLabel(router, "Train");
const article = computed(() => articles.find((a) => a.id === "techniques/" + props.technique.slug)!);
const blocks = computed(() => parseMarkdown(article.value.body));
const family = computed(() => families.find((f) => f.id === props.technique.family)?.title ?? "");
const open = ref<string[] | null>(null);
</script>

<template>
  <article class="art tview">
    <div class="ph"><div><button type="button" class="back" @click="goBack(router, '/train/techniques')"><Icon name="left" :size="16" /><span>{{ back }}</span></button><h1>{{ article.title }}</h1><div class="sub">{{ family }}</div></div></div>
    <p class="lede">{{ article.summary }}</p>
    <TechniqueUse :technique="technique" :planned="planned" @cite="open = $event" />
    <SafetyNote v-if="technique.safety" @cite="open = $event" />
    <LearnBlocks :blocks="blocks" @cite="open = $event" />
    <SourcesList :ids="article.sources" :reviewed="article.reviewed" @cite="open = $event" />
    <SourceSheet v-if="open" :ids="open" @close="open = null" />
  </article>
</template>
