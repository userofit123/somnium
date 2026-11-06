<script setup lang="ts">
// The articles of one section, with a tick on those already read.
import { computed } from "vue";
import { articlesIn, sections } from "@somnium/knowledge/content";
import { useLearn } from "../../core/learn";
import Icon from "../Icon.vue";
const props = defineProps<{ section: string }>();
const { read } = useLearn();
const title = computed(() => sections.find((s) => s.id === props.section)?.title ?? "");
const list = computed(() => articlesIn(props.section as any));
</script>

<template>
  <div class="art wide">
    <h1>{{ title }}</h1>
    <div class="card flush">
      <router-link v-for="a in list" :key="a.id" :to="'/learn/' + a.id" class="li click">
        <div class="grow"><div class="t">{{ a.title }}</div><div class="s">{{ a.summary }}</div></div>
        <Icon v-if="read[a.id]" name="check" class="rd" aria-label="Read" />
        <Icon name="right" />
      </router-link>
    </div>
  </div>
</template>
