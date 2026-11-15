<script setup lang="ts">
// A course lesson in full: what to do and why, the Learn articles that explain it with their read marks (LDJ-166), its
// sources, and the safety note where the lesson needs it.
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { findArticle } from "@somnium/knowledge/content";
import { parseMarkdown } from "@somnium/knowledge/markdown";
import { lessons, type Lesson } from "@somnium/knowledge/course";
import LearnBlocks from "../learn/LearnBlocks.vue";
import SourceSheet from "../learn/SourceSheet.vue";
import SourcesList from "../learn/SourcesList.vue";
import ReadMark from "../learn/ReadMark.vue";
import { useLearn } from "../../core/learn";
import SafetyNote from "./SafetyNote.vue";
import Icon from "../Icon.vue";
import { goBack, backLabel } from "../../core/leave";
const props = defineProps<{ lesson: Lesson }>();
// Back returns to where it was opened from (Train, Home, Learn); opened directly, to Train's Today tab
const router = useRouter();
const back = backLabel(router, "Train");
const blocks = computed(() => parseMarkdown(props.lesson.body));
const open = ref<string[] | null>(null);
const { read } = useLearn();
// the readings come from the lesson's front matter; the course tests keep every id pointing at an article
const readings = computed(() => props.lesson.readings.map((id) => findArticle(id)).filter((a) => !!a));
const readCount = computed(() => readings.value.filter((a) => read.value[a.id]).length);
</script>

<template>
  <article class="art tview">
    <div class="ph"><div><button type="button" class="back" @click="goBack(router, '/train')"><Icon name="left" :size="16" /><span>{{ back }}</span></button><h1>{{ lesson.title }}</h1><div class="sub">Lesson {{ lesson.number }} of {{ lessons.length }}</div></div></div>
    <p class="lede">{{ lesson.summary }}</p>
    <SafetyNote v-if="lesson.safety" @cite="open = $event" />
    <LearnBlocks :blocks="blocks" @cite="open = $event" />
    <div class="card tpr">
      <div class="tiny"><b>Today's practice</b></div>
      <ul><li v-for="(p, i) in lesson.practice" :key="i">{{ p }}</li></ul>
      <router-link to="/train" class="lnk inl">Tick them off in Train</router-link>
    </div>
    <template v-if="readings.length">
      <div class="sh"><h2>Read for this lesson</h2><span class="s">{{ readCount }} of {{ readings.length }} read</span></div>
      <div class="card flush">
        <router-link v-for="a in readings" :key="a.id" :to="'/learn/' + a.id" class="li click">
          <div class="grow"><div class="t">{{ a.title }}</div><div class="s">{{ a.summary }}</div><ReadMark :done="!!read[a.id]" class="s" /></div>
          <Icon name="right" />
        </router-link>
      </div>
    </template>
    <SourcesList :ids="lesson.sources" :reviewed="lesson.reviewed" @cite="open = $event" />
    <SourceSheet v-if="open" :ids="open" @close="open = null" />
  </article>
</template>
