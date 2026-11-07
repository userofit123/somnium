<script setup lang="ts">
// The articles of one section in reading order, with a read mark and a pin on each, and the section's progress.
import { computed } from "vue";
import { articlesIn, sections } from "@somnium/knowledge/content";
import { progressOf } from "@somnium/knowledge/learn";
import { useLearn } from "../../core/learn";
import Icon from "../Icon.vue";
import PinButton from "./PinButton.vue";
import ReadMark from "./ReadMark.vue";
import ProgressBar from "./ProgressBar.vue";
const props = defineProps<{ section: string }>();
const { read } = useLearn();
const title = computed(() => sections.find((s) => s.id === props.section)?.title ?? "");
const list = computed(() => articlesIn(props.section as any));
const prog = computed(() => progressOf(list.value, read.value));
</script>

<template>
  <div class="art wide">
    <h1>{{ title }}</h1>
    <div v-if="list.length > 1" class="sprog"><ProgressBar :percent="prog.percent" /><span class="s">{{ prog.percent }}% · {{ prog.read }} of {{ prog.total }} read</span></div>
    <div class="card flush">
      <div v-for="(a, i) in list" :key="a.id" class="li lrow">
        <router-link :to="'/learn/' + a.id" class="grow rlink">
          <div class="t"><span v-if="list.length > 1" class="num">{{ i + 1 }}.</span> {{ a.title }}</div>
          <div class="s">{{ a.summary }}</div>
          <ReadMark :done="!!read[a.id]" class="s" />
        </router-link>
        <PinButton :id="a.id" :label="a.title" />
        <Icon name="right" />
      </div>
    </div>
  </div>
</template>
