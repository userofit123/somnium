<script setup lang="ts">
// A course lesson in full: what to do and why, with its sources, and the safety note where the lesson needs it.
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { sources } from "@somnium/knowledge/content";
import { parseMarkdown } from "@somnium/knowledge/markdown";
import { lessons, type Lesson } from "@somnium/knowledge/course";
import LearnBlocks from "../learn/LearnBlocks.vue";
import SourceSheet from "../learn/SourceSheet.vue";
import SafetyNote from "./SafetyNote.vue";
import Icon from "../Icon.vue";
import { goBack, backLabel } from "../../core/leave";
const props = defineProps<{ lesson: Lesson }>();
// Back returns to where it was opened from (Train, Home, Learn); opened directly, to Train's Today tab
const router = useRouter();
const back = backLabel(router, "Train");
const blocks = computed(() => parseMarkdown(props.lesson.body));
const listed = computed(() => props.lesson.sources.filter((id) => sources.has(id)));
const open = ref<string[] | null>(null);
const showSources = ref(false);
</script>

<template>
  <article class="art tview">
    <button type="button" class="back" @click="goBack(router, '/train')"><Icon name="left" :size="16" /><span>{{ back }}</span></button>
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
