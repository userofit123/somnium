<script setup lang="ts">
// A course lesson in full: what to do and why, with its sources, and the safety note where the lesson needs it.
import { computed, ref } from "vue";
import { sources } from "@somnium/knowledge/content";
import { parseMarkdown } from "@somnium/knowledge/markdown";
import { lessons, type Lesson } from "@somnium/knowledge/course";
import LearnBlocks from "../learn/LearnBlocks.vue";
import SourceSheet from "../learn/SourceSheet.vue";
import SafetyNote from "./SafetyNote.vue";
import Icon from "../Icon.vue";
const props = defineProps<{ lesson: Lesson }>();
const blocks = computed(() => parseMarkdown(props.lesson.body));
const listed = computed(() => props.lesson.sources.filter((id) => sources.has(id)));
const open = ref<string[] | null>(null);
const showSources = ref(false);
</script>

<template>
  <article class="art tview">
    <router-link to="/train" class="lback"><Icon name="left" /> Train</router-link>
    <div class="eyebrow">Lesson {{ lesson.number }} of {{ lessons.length }}</div>
    <h1>{{ lesson.title }}</h1>
    <p class="lede">{{ lesson.summary }}</p>
    <SafetyNote v-if="lesson.safety" @cite="open = $event" />
    <LearnBlocks :blocks="blocks" @cite="open = $event" />
    <div class="card tpr">
      <div class="tiny"><b>Today's practice</b></div>
      <ul><li v-for="(p, i) in lesson.practice" :key="i">{{ p }}</li></ul>
      <router-link to="/train" class="lnk inl tiny">Tick them off in Train</router-link>
    </div>
    <section class="srcs">
      <button type="button" class="srch" :aria-expanded="showSources" @click="showSources = !showSources">
        Sources ({{ listed.length }}) <span class="s">· reviewed {{ lesson.reviewed }}</span>
      </button>
      <ul v-if="showSources">
        <li v-for="id in listed" :key="id"><button type="button" class="cite" @click="open = [id]">{{ id }}</button> <span class="s">{{ sources.get(id)?.text.replace(/https?:\/\/\S+/, "").trim() }}</span></li>
      </ul>
    </section>
    <SourceSheet v-if="open" :ids="open" @close="open = null" />
  </article>
</template>
