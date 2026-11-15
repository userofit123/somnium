<script setup lang="ts">
// Learn (PLAN.md §6.6, §10): sections, search, articles, glossary and FAQ, with a link to the self-assessment (in Progress).
// On a computer the section nav (the same as Settings') sits on the left and the page on the right; on a phone each
// step is its own screen.
// The article texts load with this page only (it is a lazy route), so the first screen stays small.
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { articles, sections, findArticle, articlesIn } from "@somnium/knowledge/content";
import { isPhone } from "../core/device";
import { openedFrom } from "../core/leave";
import { useLearn } from "../core/learn";
import "../styles/components/learn.css";
import Icon from "../components/Icon.vue";
import LearnHome from "../components/learn/LearnHome.vue";
import SectionView from "../components/learn/SectionView.vue";
import ArticleView from "../components/learn/ArticleView.vue";
import GlossaryView from "../components/learn/GlossaryView.vue";
import FaqView from "../components/learn/FaqView.vue";
import ResourcesView from "../components/learn/ResourcesView.vue";

const route = useRoute(), router = useRouter();
const { read } = useLearn();
const segs = computed(() => String(route.params.sub ?? "").split("/").filter(Boolean));
const kind = computed(() => {
  const [a, b] = segs.value;
  if (!a) return "home";
  if (a === "glossary") return "glossary";
  if (a === "faq") return "faq";
  if (a === "resources") return "resources";
  if (b && findArticle(`${a}/${b}`)) return "article";
  if (sections.some((s) => s.id === a)) return "section";
  return "home";
});
const article = computed(() => findArticle(segs.value.join("/")));
const section = computed(() => segs.value[0] ?? "");
const single = (id: string) => id === "glossary" || id === "faq";
// the phone's one back step: from an article to its section, from a section to Learn. An article opened from outside
// Learn (a lesson's reading list) has its own history Back in ArticleView instead.
const back = computed(() => {
  void route.path; // history.state isn't reactive: re-read on every navigation
  if (kind.value === "article" && history.state?.back && !openedFrom("/learn")) return null;
  if (kind.value === "article") return { to: "/learn/" + section.value, label: sections.find((s) => s.id === section.value)?.title ?? "Back" };
  if (kind.value === "home") return null;
  return { to: "/learn", label: "Learn" };
});
const total = articles.length;
</script>

<template>
  <div class="page learn">
    <!-- on a computer: app.css's .split.nav, the same section nav as Settings -->
    <div :class="{ 'split nav': !isPhone }">
      <aside v-if="!isPhone" class="card snav side" aria-label="Learn sections">
        <router-link to="/learn" class="sni" :class="{ on: kind === 'home' }"><Icon name="home" :size="17" /><span class="grow">Learn home</span></router-link>
        <div class="sng">Sections</div>
        <template v-for="s in sections" :key="s.id">
          <router-link :to="'/learn/' + s.id" class="sni" :class="{ on: section === s.id && (kind === 'section' || single(s.id)), in: section === s.id && kind === 'article' }">
            <Icon name="book" :size="17" /><span class="grow">{{ s.title }}</span><span v-if="!single(s.id)" class="n">{{ articlesIn(s.id).length }}</span>
          </router-link>
          <template v-if="section === s.id && !single(s.id) && (kind === 'section' || kind === 'article')">
            <router-link v-for="a in articlesIn(s.id)" :key="a.id" :to="'/learn/' + a.id" class="sni sub" :class="{ on: article?.id === a.id }" :aria-current="article?.id === a.id ? 'page' : undefined">
              <span class="grow">{{ a.title }}</span><Icon v-if="read[a.id]" name="check" :size="14" />
            </router-link>
          </template>
        </template>
        <div class="sng">More</div>
        <router-link to="/learn/resources" class="sni" :class="{ on: kind === 'resources' }"><Icon name="link" :size="17" /><span class="grow">Resources</span></router-link>
        <router-link to="/progress/self-assessment" class="sni"><Icon name="graduation" :size="17" /><span class="grow">Self-assessment</span></router-link>
        <div class="tiny">{{ total }} articles</div>
      </aside>
      <div>
        <!-- the same Back pill as every other page, just above the view's own header -->
        <button v-if="isPhone && back" type="button" class="back" @click="router.push(back.to)"><Icon name="left" :size="16" /><span>{{ back.label }}</span></button>
        <LearnHome v-if="kind === 'home'" />
        <SectionView v-else-if="kind === 'section'" :section="section" />
        <ArticleView v-else-if="kind === 'article' && article" :key="article.id" :article="article" />
        <GlossaryView v-else-if="kind === 'glossary'" />
        <FaqView v-else-if="kind === 'faq'" />
        <ResourcesView v-else-if="kind === 'resources'" />
      </div>
    </div>
  </div>
</template>
