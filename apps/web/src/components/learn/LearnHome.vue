<script setup lang="ts">
// Learn home: search, Start here, Continue reading and the sections in order. Search runs on the device.
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { articles, sections, findArticle, articlesIn } from "@somnium/knowledge/content";
import { continueReading } from "@somnium/knowledge/learn";
import { buildIndex, search, highlight, excerpt } from "@somnium/knowledge/search";
import { useLearn } from "../../core/learn";
import Icon from "../Icon.vue";

defineProps<{ showSections: boolean }>();
const router = useRouter(), route = useRoute();
const { read, last } = useLearn();
const q = ref(String(route.query.q ?? ""));
// the index is built the first time someone searches, not when the page opens
let index: ReturnType<typeof buildIndex> | null = null;
const hits = computed(() => {
  if (!q.value.trim()) return [];
  index ??= buildIndex(articles);
  return search(index, q.value);
});
watch(q, (v) => { if (route.path === "/learn") void router.replace({ path: "/learn", query: v.trim() ? { q: v } : {} }); });
const startIds = ["basics/what-is-lucid-dreaming", "basics/how-this-app-helps"];
const start = computed(() => startIds.map((id) => findArticle(id)).filter((a) => !!a));
const cont = computed(() => continueReading(articles, read.value, last.value || undefined));
const title = (id: string) => findArticle(id)?.title ?? id;
const secOf = (id: string) => sections.find((s) => s.id === id.split("/")[0])?.title ?? "";
const readCount = (sec: string) => articlesIn(sec as any).filter((a) => read.value[a.id]).length;
</script>

<template>
  <div class="art wide">
    <h1>Learn</h1>
    <p class="lede">What is known about lucid dreaming, with the sources behind it. Everything here works offline.</p>
    <div class="search lsearch">
      <Icon name="search" />
      <input v-model="q" type="search" placeholder="Search titles, summaries and text" aria-label="Search Learn" autocomplete="off" />
    </div>

    <template v-if="q.trim()">
      <p v-if="!hits.length" class="empty sm">Nothing matches "{{ q }}".</p>
      <div v-else class="card flush">
        <router-link v-for="h in hits" :key="h.id" :to="'/learn/' + h.id" class="li click hit">
          <div class="grow">
            <div class="t">{{ title(h.id) }}</div>
            <div class="s hl"><template v-for="(p, i) in highlight(excerpt(h.line, q), q)" :key="i"><mark v-if="p.hit">{{ p.text }}</mark><template v-else>{{ p.text }}</template></template></div>
            <div class="s ldim">{{ secOf(h.id) }}</div>
          </div>
        </router-link>
      </div>
    </template>

    <template v-else>
      <router-link v-if="cont && (last || Object.keys(read).length)" :to="'/learn/' + cont.id" class="card click controw">
        <div class="grow"><div class="s">Continue reading</div><div class="t">{{ cont.title }}</div></div>
        <Icon name="right" />
      </router-link>
      <h2 class="sh">Start here</h2>
      <div class="starts">
        <router-link v-for="a in start" :key="a!.id" :to="'/learn/' + a!.id" class="card click">
          <b>{{ a!.title }}</b><div class="s">{{ a!.summary }}</div>
        </router-link>
      </div>
      <template v-if="showSections">
        <h2 class="sh">Sections</h2>
        <div class="card flush">
          <router-link v-for="s in sections" :key="s.id" :to="'/learn/' + s.id" class="li click">
            <div class="grow"><div class="t">{{ s.title }}</div></div>
            <div class="r s">{{ readCount(s.id) }} of {{ articlesIn(s.id).length }} read</div>
            <Icon name="right" />
          </router-link>
        </div>
        <router-link to="/learn/where-am-i" class="card click controw wheream">
          <div class="grow"><div class="t">Where am I</div><div class="s">Two short questions that show where you start.</div></div>
          <Icon name="right" />
        </router-link>
      </template>
    </template>
  </div>
</template>
