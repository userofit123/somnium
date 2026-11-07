<script setup lang="ts">
// One article: the rendered body, sources with the reviewed date, the "try it" button, previous and next.
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { articles, sources, type Article } from "@somnium/knowledge/content";
import { parseMarkdown } from "@somnium/knowledge/markdown";
import { neighbours } from "@somnium/knowledge/learn";
import { sections } from "@somnium/knowledge/content";
import LearnBlocks from "./LearnBlocks.vue";
import SourceSheet from "./SourceSheet.vue";
import { useLearn, recordOpened, setRead, togglePinned, useReadAtEnd } from "../../core/learn";
import Menu, { type MenuItem } from "../Menu.vue";
import PinButton from "./PinButton.vue";
import ReadMark from "./ReadMark.vue";

const props = defineProps<{ article: Article }>();
const router = useRouter();
const { read, last, pinned } = useLearn();
const blocks = computed(() => parseMarkdown(props.article.body));
const near = computed(() => neighbours(articles, props.article.id));
const sectionTitle = computed(() => sections.find((s) => s.id === props.article.section)?.title ?? "");
const open = ref<string[] | null>(null);
const listed = computed(() => props.article.sources.filter((id) => sources.has(id)));
const showSources = ref(false);
const techLabel = computed(() => (props.article.tryIt ?? "").replace(/-/g, " "));

const { end, arm } = useReadAtEnd(() => props.article.id, read);
onMounted(() => recordOpened(last.value, props.article.id));
watch(() => props.article.id, () => { showSources.value = false; recordOpened(last.value, props.article.id); void arm(); });
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
    <LearnBlocks :blocks="blocks" @cite="open = $event" />
    <div v-if="article.tryIt" class="tryit card">
      <div><b>Try it</b><div class="s">Put this into practice with the {{ techLabel }} technique.</div></div>
      <router-link class="btn" :to="{ path: '/train', query: { technique: article.tryIt } }">Try it in Train</router-link>
    </div>
    <section class="srcs">
      <button type="button" class="srch" :aria-expanded="showSources" @click="showSources = !showSources">
        Sources ({{ listed.length }}) <span class="s">· reviewed {{ article.reviewed }}</span>
      </button>
      <ul v-if="showSources">
        <li v-for="id in listed" :key="id"><button type="button" class="cite" @click="open = [id]">{{ id }}</button> <span class="s">{{ sources.get(id)?.text.replace(/https?:\/\/\S+/, "").trim() }}</span></li>
      </ul>
    </section>
    <div ref="end" class="endmark" aria-hidden="true" />
    <div v-if="near.prev || near.next" class="lpn" role="navigation" aria-label="In this section">
      <button v-if="near.prev" type="button" class="card click prev" @click="go(near.prev!)"><span class="s">Previous</span><b>{{ near.prev.title }}</b></button>
      <span v-else />
      <button v-if="near.next" type="button" class="card click next" @click="go(near.next!)"><span class="s">Next</span><b>{{ near.next.title }}</b></button>
    </div>
    <SourceSheet v-if="open" :ids="open" @close="open = null" />
  </article>
</template>
