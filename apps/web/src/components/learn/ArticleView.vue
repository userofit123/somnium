<script setup lang="ts">
// One article: the rendered body, sources with the reviewed date, previous and next. A technique article carries the
// same evidence card and "Use tonight" as the technique page in Train (LDJ-128), so planning never leaves Learn; another
// article that puts a technique into practice links to that technique's article.
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { articles, findArticle, type Article } from "@somnium/knowledge/content";
import { parseMarkdown } from "@somnium/knowledge/markdown";
import { neighbours } from "@somnium/knowledge/learn";
import { sections } from "@somnium/knowledge/content";
import LearnBlocks from "./LearnBlocks.vue";
import SourceSheet from "./SourceSheet.vue";
import SourcesList from "./SourcesList.vue";
import TechniqueUse from "../train/TechniqueUse.vue";
import SafetyNote from "../train/SafetyNote.vue";
import { findTechnique } from "@somnium/knowledge/techniques";
import { useLearn, recordOpened, setRead, togglePinned, useReadAtEnd } from "../../core/learn";
import Menu, { type MenuItem } from "../Menu.vue";
import PinButton from "./PinButton.vue";
import ReadMark from "./ReadMark.vue";
import Icon from "../Icon.vue";

const props = defineProps<{ article: Article }>();
const router = useRouter();
const { read, last, pinned } = useLearn();
const blocks = computed(() => parseMarkdown(props.article.body));
const near = computed(() => neighbours(articles, props.article.id));
const sectionTitle = computed(() => sections.find((s) => s.id === props.article.section)?.title ?? "");
const open = ref<string[] | null>(null);
const tech = computed(() => (props.article.tryIt ? findTechnique(props.article.tryIt) : undefined));
// the technique's own article shows the card inline; any other article links to it
const ownTech = computed(() => (tech.value && props.article.id === "techniques/" + tech.value.slug ? tech.value : undefined));
const techArticle = computed(() => (tech.value && !ownTech.value ? findArticle("techniques/" + tech.value.slug) : undefined));

const { end, arm } = useReadAtEnd(() => props.article.id, read);
onMounted(() => recordOpened(last.value, props.article.id));
watch(() => props.article.id, () => { recordOpened(last.value, props.article.id); void arm(); });
const isRead = computed(() => !!read.value[props.article.id]);
const isPinned = computed(() => pinned.value.includes(props.article.id));
const menu = computed((): MenuItem[] => [
  { label: isPinned.value ? "Unpin" : "Pin for quick access", icon: "pin", run: () => togglePinned(pinned.value, props.article.id) },
  { label: isRead.value ? "Mark as unread" : "Mark as read", icon: "check", run: () => setRead(props.article.id, !isRead.value) },
]);
const go = (a: Article) => router.push("/learn/" + a.id);
</script>

<template>
  <article class="art">
    <div class="ahead">
      <div class="eyebrow grow">{{ sectionTitle }} <ReadMark :done="isRead" class="rdm-eb" /></div>
      <PinButton :id="article.id" :label="article.title" />
      <Menu :items="menu" label="Article actions" />
    </div>
    <h1>{{ article.title }}</h1>
    <p class="lede">{{ article.summary }}</p>
    <template v-if="ownTech">
      <TechniqueUse :technique="ownTech" @cite="open = $event" />
      <SafetyNote v-if="ownTech.safety" @cite="open = $event" />
    </template>
    <LearnBlocks :blocks="blocks" @cite="open = $event" />
    <router-link v-if="techArticle" :to="'/learn/' + techArticle.id" class="tryit card click">
      <div class="grow"><b>Try it</b><div class="s">Put this into practice with {{ techArticle.title }}.</div></div>
      <Icon name="right" />
    </router-link>
    <SourcesList :ids="article.sources" :reviewed="article.reviewed" @cite="open = $event" />
    <div ref="end" class="endmark" aria-hidden="true" />
    <div v-if="near.prev || near.next" class="lpn" role="navigation" aria-label="In this section">
      <button v-if="near.prev" type="button" class="card click prev" @click="go(near.prev!)"><span class="s">Previous</span><b>{{ near.prev.title }}</b></button>
      <span v-else />
      <button v-if="near.next" type="button" class="card click next" @click="go(near.next!)"><span class="s">Next</span><b>{{ near.next.title }}</b></button>
    </div>
    <SourceSheet v-if="open" :ids="open" @close="open = null" />
  </article>
</template>
