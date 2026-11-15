<script setup lang="ts">
// Your path (LDJ-154): the quiet milestones. Each step reached with its day, then the next one, greyed, with what it
// takes. Worked out here from the journal and the course on this device (shared milestones.ts yourPath); nothing is
// stored or sent. No points, badges or confetti: plain text and a date. On Progress it lists every step; as Home's
// optional card (`home`) it shows only the latest step and the next one.
import { computed, ref } from "vue";
import { COURSE_LESSONS, PATH_SOURCES, yourPath } from "@somnium/shared";
import { useJournal } from "../../api/journal";
import { useCourse } from "../../api/train";
import { useSettings } from "../../api/queries";
import { localYmd, useFmt } from "../../core/format";
import Icon from "../Icon.vue";
import ProgressBar from "../ProgressBar.vue";
import SourceSheet from "../learn/SourceSheet.vue";
import CiteChips from "../learn/CiteChips.vue";

const props = defineProps<{ home?: boolean }>();
const j = useJournal();
const course = useCourse();
const settings = useSettings();
const fmt = useFmt();
const open = ref<string[] | null>(null);

const path = computed(() => {
  const lessons = (course.data.value ?? []).filter((r) => (COURSE_LESSONS as readonly string[]).includes(r.lessonId))
    .map((r) => ({ lessonId: r.lessonId, doneOn: r.state === "done" && r.doneAt ? localYmd(new Date(r.doneAt)) : null }));
  return yourPath(j.nights.data.value ?? [], j.facts.data.value ?? [], lessons, COURSE_LESSONS.length, settings.value.setup.experience);
});
// newest first on the page, so the latest step is at the top under the next one
const reached = computed(() => {
  const r = [...path.value.reached].reverse();
  return props.home ? r.slice(0, 1) : r;
});
const when = (ymd: string) => fmt.value.date(ymd, { day: "numeric", month: "long", year: "numeric" });
</script>

<template>
  <section :class="home ? 'hextra' : undefined" data-testid="pathcard">
    <div class="card">
      <div class="lbl hgap"><span class="bi"><Icon name="map" :size="16" /></span><span class="grow">Your path</span><router-link v-if="home" to="/progress" class="lnk">All steps</router-link></div>
      <div class="list">
        <div v-if="path.next" class="li path-next">
          <span class="bi sg mut"><Icon name="right" :size="18" /></span>
          <div class="grow">
            <div class="t">Next: {{ path.next.title }}</div>
            <div v-if="path.next.takes" class="s">{{ path.next.takes }}</div>
            <div v-if="path.next.need" class="row path-bar"><ProgressBar :percent="(100 * (path.next.have ?? 0)) / path.next.need" muted class="grow" /><span class="tiny num">{{ path.next.have ?? 0 }} of {{ path.next.need }}</span></div>
          </div>
        </div>
        <div v-for="s in reached" :key="s.id" class="li">
          <span class="bi sg"><Icon name="check" :size="18" /></span>
          <div class="grow"><div class="t">{{ s.title }}</div><div class="s">{{ when(s.on!) }}</div></div>
        </div>
      </div>
      <div v-if="!home" class="tiny ins-note">Recall comes first, then lucid dreams: the order of the classic course. <CiteChips :ids="PATH_SOURCES" @cite="open = $event" /></div>
    </div>
    <SourceSheet v-if="open" :ids="open" @close="open = null" />
  </section>
</template>

<style>
.path-next .t { color: var(--tx2); }
.path-bar { margin-top: var(--tdy); }
</style>
