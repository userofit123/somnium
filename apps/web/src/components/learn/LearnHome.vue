<script setup lang="ts">
// Learn home: search, overall progress, Pinned, Continue reading, the Start here path, sections with their progress,
// the course lessons (so a lesson can be pinned) and Resources. Search runs on the device.
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { articles, sections, findArticle, articlesIn } from "@somnium/knowledge/content";
import { continueReading, progressOf, startPath, pinId, slug } from "@somnium/knowledge/learn";
import { glossaryTerms, faqItems } from "@somnium/knowledge/learn";
import { lessons } from "@somnium/knowledge/course";
import { buildIndex, search, highlight, excerpt } from "@somnium/knowledge/search";
import { useLearn } from "../../core/learn";
import Icon from "../Icon.vue";
import PinButton from "./PinButton.vue";
import ReadMark from "./ReadMark.vue";
import ProgressBar from "./ProgressBar.vue";

const router = useRouter(), route = useRoute();
const { read, last, pinned } = useLearn();
const q = ref(String(route.query.q ?? ""));
// the index is built the first time someone searches, not when the page opens
let index: ReturnType<typeof buildIndex> | null = null;
const hits = computed(() => {
  if (!q.value.trim()) return [];
  index ??= buildIndex(articles);
  return search(index, q.value);
});
watch(q, (v) => { if (route.path === "/learn") void router.replace({ path: "/learn", query: v.trim() ? { q: v } : {} }); });

const overall = computed(() => progressOf(articles, read.value));
const path = computed(() => startPath.map((id) => findArticle(id)).filter((a) => !!a));
const pathProg = computed(() => progressOf(path.value as { id: string }[], read.value));
const cont = computed(() => continueReading(articles, read.value, last.value || undefined));
const title = (id: string) => findArticle(id)?.title ?? id;
const secOf = (id: string) => sections.find((s) => s.id === id.split("/")[0])?.title ?? "";
const secProg = (sec: string) => progressOf(articlesIn(sec as any), read.value);
const single = (id: string) => id === "glossary" || id === "faq";

// pinned ids to rows: an article, a course lesson, a glossary term or a FAQ question; ids that no longer exist are skipped
interface PinRow { id: string; title: string; kind: string; to: string | { path: string; query: Record<string, string> } }
const terms = computed(() => glossaryTerms(findArticle("glossary/glossary")?.body ?? ""));
const faqs = computed(() => faqItems(findArticle("faq/faq")?.body ?? ""));
const pinRows = computed<PinRow[]>(() => pinned.value.flatMap((id): PinRow[] => {
  if (id.startsWith("lesson:")) {
    const l = lessons.find((x) => x.id === id.slice(7));
    return l ? [{ id, title: l.title, kind: "Course lesson " + l.number, to: { path: "/train", query: { lesson: l.id } } }] : [];
  }
  if (id.startsWith("term:")) {
    const t = terms.value.find((x) => slug(x.term) === id.slice(5));
    return t ? [{ id, title: t.term, kind: "Glossary", to: { path: "/learn/glossary", query: { term: id.slice(5) } } }] : [];
  }
  if (id.startsWith("faq:")) {
    const f = faqs.value.find((x) => slug(x.question) === id.slice(4));
    return f ? [{ id, title: f.question, kind: "FAQ", to: { path: "/learn/faq", query: { item: id.slice(4) } } }] : [];
  }
  const a = findArticle(id);
  return a ? [{ id, title: a.title, kind: secOf(id), to: "/learn/" + id }] : [];
}));
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
        <div v-for="h in hits" :key="h.id" class="li lrow">
          <router-link :to="'/learn/' + h.id" class="grow rlink hit">
            <div class="t">{{ title(h.id) }}</div>
            <div class="s hl"><template v-for="(p, i) in highlight(excerpt(h.line, q), q)" :key="i"><mark v-if="p.hit">{{ p.text }}</mark><template v-else>{{ p.text }}</template></template></div>
            <div class="s ldim">{{ secOf(h.id) }} <ReadMark :done="!!read[h.id]" /></div>
          </router-link>
          <PinButton :id="h.id" :label="title(h.id)" />
        </div>
      </div>
    </template>

    <template v-else>
      <div class="card overall">
        <div class="t">You've read {{ overall.percent }}% · {{ overall.read }} of {{ overall.total }}</div>
        <ProgressBar :percent="overall.percent" />
      </div>

      <template v-if="pinRows.length">
        <h2 class="sh">Pinned</h2>
        <div class="card flush">
          <div v-for="p in pinRows" :key="p.id" class="li lrow">
            <router-link :to="p.to" class="grow rlink"><div class="t">{{ p.title }}</div><div class="s">{{ p.kind }}</div></router-link>
            <PinButton :id="p.id" :label="p.title" />
          </div>
        </div>
      </template>

      <router-link v-if="cont && (last || Object.keys(read).length)" :to="'/learn/' + cont.id" class="card click controw">
        <div class="grow"><div class="s">Continue reading</div><div class="t">{{ cont.title }}</div></div>
        <Icon name="right" />
      </router-link>

      <h2 class="sh">Start here</h2>
      <p class="s startlede">A short path through the most important articles, in order. {{ pathProg.read }} of {{ pathProg.total }} read.</p>
      <ProgressBar :percent="pathProg.percent" class="pgap" />
      <div class="card flush">
        <div v-for="(a, i) in path" :key="a!.id" class="li lrow">
          <router-link :to="'/learn/' + a!.id" class="grow rlink">
            <div class="t"><span class="num">{{ i + 1 }}.</span> {{ a!.title }}</div>
            <div class="s">{{ a!.summary }}</div>
            <ReadMark :done="!!read[a!.id]" class="s" />
          </router-link>
          <PinButton :id="a!.id" :label="a!.title" />
        </div>
      </div>

      <h2 class="sh">Sections</h2>
      <div class="card flush">
        <router-link v-for="s in sections" :key="s.id" :to="'/learn/' + s.id" class="li click">
          <div class="grow">
            <div class="t">{{ s.title }}</div>
            <template v-if="!single(s.id)"><ProgressBar :percent="secProg(s.id).percent" class="pgap" /></template>
          </div>
          <div v-if="!single(s.id)" class="r s">{{ secProg(s.id).percent }}% · {{ secProg(s.id).read }} of {{ secProg(s.id).total }}</div>
          <Icon name="right" />
        </router-link>
      </div>

      <h2 class="sh">Course lessons</h2>
      <div class="card flush">
        <div v-for="l in lessons" :key="l.id" class="li lrow">
          <router-link :to="{ path: '/train', query: { lesson: l.id } }" class="grow rlink"><div class="t"><span class="num">{{ l.number }}.</span> {{ l.title }}</div><div class="s">{{ l.summary }}</div></router-link>
          <PinButton :id="pinId.lesson(l.id)" :label="l.title" />
        </div>
      </div>

      <router-link to="/learn/resources" class="card click controw wheream">
        <div class="grow"><div class="t">Resources</div><div class="s">Books, key studies, organisations and communities.</div></div>
        <Icon name="right" />
      </router-link>
      <router-link to="/learn/where-am-i" class="card click controw">
        <div class="grow"><div class="t">Where am I</div><div class="s">Two short questions that show where you start.</div></div>
        <Icon name="right" />
      </router-link>
    </template>
  </div>
</template>
