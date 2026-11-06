<script setup lang="ts">
// Home's optional cards (PLAN.md §6.1, §11): each one only while its switch is on in Settings → Features.
import { useFmt } from "../../core/format";
defineProps<{
  lesson: { id: string; number: number; of: number; title: string; summary: string } | null;
  tip: { id: string; title: string; summary: string } | null;
  lucid: { id: string; date: string; title: string } | null;
  /** the top of the Signs shortlist (shared signs.ts signShortlist): name and how often */
  signs: { id: string; name: string; line: string }[] | null;
}>();
const fmt = useFmt();
</script>

<template>
  <section v-if="signs" class="hextra">
    <div class="sh"><h2>Top dream signs</h2><router-link to="/signs" class="lnk tiny">All signs</router-link></div>
    <div v-if="!signs.length" class="card empty sm">Your dream signs show here once one turns up in a few dreams.</div>
    <div v-else class="card"><div class="list">
      <router-link v-for="s in signs" :key="s.id" :to="{ name: 'signs-element', params: { id: s.id } }" class="li click hli"><div class="grow"><div class="t">{{ s.name }}</div><div class="s">{{ s.line }}</div></div></router-link>
    </div></div>
  </section>
  <section v-if="lesson" class="hextra">
    <div class="sh"><h2>Next lesson</h2><span class="tiny">Lesson {{ lesson.number }} of {{ lesson.of }}</span></div>
    <router-link :to="{ path: '/train', query: { lesson: lesson.id } }" class="card hcard"><div class="t">{{ lesson.title }}</div><div class="tiny hclamp">{{ lesson.summary }}</div></router-link>
  </section>
  <section v-if="tip" class="hextra">
    <div class="sh"><h2>A tip from Learn</h2></div>
    <router-link :to="'/learn/' + tip.id" class="card hcard"><div class="t">{{ tip.title }}</div><div class="tiny hclamp">{{ tip.summary }}</div></router-link>
  </section>
  <section v-if="lucid" class="hextra">
    <div class="sh"><h2>Last lucid dream</h2></div>
    <router-link :to="{ name: 'journal-dream', params: { id: lucid.id } }" class="card hcard"><div class="t">{{ lucid.title }}</div><div class="tiny">{{ fmt.date(lucid.date, { weekday: "long", day: "numeric", month: "long" }) }}</div></router-link>
  </section>
</template>
