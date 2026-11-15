<script setup lang="ts">
// Home's optional cards (PLAN.md §6.1): Home passes one at a time, as its own block, while it is on in Edit home.
import { useRouter } from "vue-router";
import { useFmt } from "../../core/format";
import { uuidv7 } from "../../api/journal";
import Icon from "../Icon.vue";
defineProps<{
  lesson?: { id: string; number: number; of: number; title: string; summary: string } | null;
  tip?: { id: string; title: string; summary: string } | null;
  lucid?: { id: string; date: string; title: string } | null;
  /** the top of the Signs shortlist (shared signs.ts signShortlist): name and how often */
  signs?: { id: string; name: string; line: string }[] | null;
}>();
const fmt = useFmt();
const router = useRouter();
// signs come from dreams, so the empty card offers the one thing that fills it
const write = () => router.push({ name: "journal-write", params: { id: uuidv7() }, query: { new: "1" } });
</script>

<template>
  <section v-if="signs" class="hextra">
    <div class="sh"><h2>Top dream signs</h2><router-link v-if="signs.length" to="/signs" class="lnk tiny">All signs</router-link></div>
    <div v-if="!signs.length" class="card empty"><Icon name="eye" :size="34" /><b>No dream signs yet</b>They show here once something turns up in a few of your dreams.<br /><button class="btn tonal" type="button" @click="write">Write a dream</button></div>
    <div v-else class="card"><div class="list">
      <router-link v-for="s in signs" :key="s.id" :to="{ name: 'signs-element', params: { id: s.id } }" class="li click hli"><div class="grow"><div class="t">{{ s.name }}</div><div class="s">{{ s.line }}</div></div></router-link>
    </div></div>
  </section>
  <section v-if="lesson" class="hextra">
    <div class="sh"><h2>Next lesson</h2><span class="tiny">Lesson {{ lesson.number }} of {{ lesson.of }}</span></div>
    <router-link :to="'/train/lesson/' + lesson.id" class="card hcard"><div class="t">{{ lesson.title }}</div><div class="tiny hclamp">{{ lesson.summary }}</div></router-link>
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
