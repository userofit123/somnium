<script setup lang="ts">
// "For you" (PLAN.md §8.2, LDJ-27): the recommendations from the person's own nights, dreams and checks, on Home and
// Train. The rules are pure (packages/shared/src/recommend.ts); this card only loads what they read and shows the top
// one, with "More" for the rest. Each says why (the person's own numbers) and cites its sources, which open the same
// sheet as Learn. A quiet card: links only, never the screen's primary button; nothing at all when nothing applies.
// Hiding one for 14 days is a plain rule id and date in the synced settings (nothing personal).
import { computed, ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { recommend, dismiss, rcSchedule, type Recommendation } from "@somnium/shared";
import { useJournal } from "../api/journal";
import { useTrain } from "../api/train";
import { saveSettings, useSettings } from "../api/queries";
import { REMINDERS_KEY, fetchReminders, rcRow } from "../native/reminders";
import { localYmd } from "../core/format";
import { useToday } from "../core/today";
import Menu from "./Menu.vue";
import SourceSheet from "./learn/SourceSheet.vue";
import "../styles/components/learn.css";
import "../styles/components/foryou.css";

const j = useJournal();
const t = useTrain();
const reminders = useQuery({ queryKey: [...REMINDERS_KEY], queryFn: fetchReminders, staleTime: 60_000 });
const settings = useSettings();
const today = useToday();

const recs = computed<Recommendation[]>(() => {
  // the rules need the whole picture: say nothing until every list is in, rather than something wrong for a moment
  if (!j.nights.data.value || !j.facts.data.value || !t.checks.data.value || !reminders.data.value) return [];
  const row = rcRow(reminders.data.value);
  const s = row ? rcSchedule(row.schedule) : null;
  return recommend({
    nights: j.nights.data.value,
    dreams: j.facts.data.value,
    checkDays: t.checks.data.value.map((c) => localYmd(new Date(c.at))),
    reminders: { on: !!row?.enabled, perDay: s?.perDay, habits: s?.habits.length },
    dismissed: settings.value.recommend?.dismissed ?? [],
  }, today.value);
});

const more = ref(false);
const open = ref<string[] | null>(null);
const shown = computed(() => (more.value ? recs.value : recs.value.slice(0, 1)));
const hide = (id: string) => saveSettings({ recommend: { dismissed: dismiss(settings.value.recommend?.dismissed, id, today.value) } }, { quiet: true });
</script>

<template>
  <section v-if="recs.length" class="foryou">
    <div class="sh"><h2>For you</h2><button v-if="recs.length > 1" type="button" class="lnk" :aria-expanded="more" @click="more = !more">{{ more ? "Less" : `More (${recs.length - 1})` }}</button></div>
    <div class="card"><div class="fylist">
      <article v-for="r in shown" :key="r.id" class="fyitem" :data-rec="r.id">
        <div class="fyhead">
          <div class="t">{{ r.title }}</div>
          <Menu :items="[{ label: 'Hide for 2 weeks', icon: 'clock', run: () => hide(r.id) }]" label="More actions" />
        </div>
        <p class="fybody">{{ r.body }}</p>
        <p class="fywhy tiny"><b>Why:</b> {{ r.reason }}</p>
        <div class="fyfoot">
          <span class="fycites"><button v-for="id in r.sources" :key="id" type="button" class="cite" :aria-label="'Source ' + id" @click="open = [id]">{{ id }}</button></span>
          <router-link v-if="r.action" :to="r.action.to" class="lnk inl">{{ r.action.label }}</router-link>
          <router-link v-if="r.link" :to="r.link.to" class="lnk inl">{{ r.link.label }}</router-link>
        </div>
      </article>
    </div></div>
    <SourceSheet v-if="open" :ids="open" @close="open = null" />
  </section>
</template>
