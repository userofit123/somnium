<script setup lang="ts">
// Learn (PLAN.md §6.6, §10): sections, search, articles, glossary, FAQ and the "Where am I" scales.
// On a computer a section list sits on the left and the page on the right; on a phone each step is its own screen.
// The article texts load with this page only (it is a lazy route), so the first screen stays small.
import { computed } from "vue";
import { useRoute } from "vue-router";
import { articles, sections, findArticle, articlesIn } from "@somnium/knowledge/content";
import { isPhone } from "../core/device";
import { useLearn } from "../core/learn";
import "../styles/components/learn.css";
import Icon from "../components/Icon.vue";
import LearnHome from "../components/learn/LearnHome.vue";
import SectionView from "../components/learn/SectionView.vue";
import ArticleView from "../components/learn/ArticleView.vue";
import GlossaryView from "../components/learn/GlossaryView.vue";
import FaqView from "../components/learn/FaqView.vue";
import Questionnaires from "../components/learn/Questionnaires.vue";

const route = useRoute();
const { read } = useLearn();
const segs = computed(() => String(route.params.sub ?? "").split("/").filter(Boolean));
const kind = computed(() => {
  const [a, b] = segs.value;
  if (!a) return "home";
  if (a === "where-am-i") return "where";
  if (a === "glossary") return "glossary";
  if (a === "faq") return "faq";
  if (b && findArticle(`${a}/${b}`)) return "article";
  if (sections.some((s) => s.id === a)) return "section";
  return "home";
});
const article = computed(() => findArticle(segs.value.join("/")));
const section = computed(() => segs.value[0] ?? "");
const single = (id: string) => id === "glossary" || id === "faq";
// the phone's one back step: from an article to its section, from a section to Learn
const back = computed(() => {
  if (kind.value === "article") return { to: "/learn/" + section.value, label: sections.find((s) => s.id === section.value)?.title ?? "Back" };
  if (kind.value === "home") return null;
  return { to: "/learn", label: "Learn" };
});
const total = articles.length;
</script>

<template>
  <div class="page learn" :class="{ ph2: isPhone }">
    <aside v-if="!isPhone" class="lnav" aria-label="Learn sections">
      <router-link to="/learn" class="ln" :class="{ on: kind === 'home' }">Learn home</router-link>
      <template v-for="s in sections" :key="s.id">
        <router-link :to="'/learn/' + s.id" class="ln" :class="{ on: section === s.id && kind !== 'where' && kind !== 'home' }">
          {{ s.title }}<span class="s">{{ single(s.id) ? "" : articlesIn(s.id).length }}</span>
        </router-link>
        <div v-if="section === s.id && !single(s.id) && kind !== 'where'" class="lsub">
          <router-link v-for="a in articlesIn(s.id)" :key="a.id" :to="'/learn/' + a.id" class="lsl" :class="{ on: article?.id === a.id, done: !!read[a.id] }">{{ a.title }}</router-link>
        </div>
      </template>
      <router-link to="/learn/where-am-i" class="ln" :class="{ on: kind === 'where' }">Where am I</router-link>
      <div class="s lcount">{{ total }} articles</div>
    </aside>
    <main class="lmain">
      <router-link v-if="isPhone && back" :to="back.to" class="lback"><Icon name="left" /> {{ back.label }}</router-link>
      <LearnHome v-if="kind === 'home'" :show-sections="isPhone" />
      <SectionView v-else-if="kind === 'section'" :section="section" />
      <ArticleView v-else-if="kind === 'article' && article" :key="article.id" :article="article" />
      <GlossaryView v-else-if="kind === 'glossary'" />
      <FaqView v-else-if="kind === 'faq'" />
      <Questionnaires v-else-if="kind === 'where'" />
    </main>
  </div>
</template>
