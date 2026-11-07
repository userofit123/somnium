<script setup lang="ts">
// "Today" (PLAN.md §6.1): reality checks done against the reminders' plan for today (0 planned with reminders off),
// the next reminder while they are on, and today's course practice with the same ticks as Train (practice_log).
import { computed } from "vue";
import { useRouter } from "vue-router";
import { checksLine, practiceLine, type PracticeLog } from "@somnium/shared";
import { tickPractice } from "../../api/train";
import { useChange } from "../../api/queries";
import { useFmt } from "../../core/format";
import Icon from "../Icon.vue";

const props = defineProps<{ done: number; planned: number; next: number | null; remindersOn: boolean; today: string; primary: boolean;
  lesson: { id: string; title: string } | null; items: { id: string; text: string; row?: PracticeLog }[] }>();
const router = useRouter();
const fmt = useFmt();
const checks = computed(() => checksLine(props.done, props.planned));
const pct = computed(() => (props.planned ? Math.min(100, Math.round((props.done / props.planned) * 100)) : 0));
const practice = computed(() => practiceLine(props.items.filter((i) => i.row).length, props.items.length));
const tick = useChange((id: string, on: boolean, row?: PracticeLog) => tickPractice(id, props.today, on, row), ["practice"]);
</script>

<template>
  <section class="htoday">
    <div class="sh"><h2>Today</h2></div>
    <div class="card">
      <div class="hrow">
        <div class="grow">
          <div class="t">Reality checks</div>
          <div class="tiny">{{ checks }}<template v-if="remindersOn && next"> · next reminder {{ fmt.time(new Date(next).toISOString()) }}</template><template v-else-if="!remindersOn"> · reminders off</template></div>
        </div>
        <button class="btn" :class="{ o: !primary }" @click="router.push('/check')">Log a check</button>
      </div>
      <div v-if="planned" class="tbar hbar" role="progressbar" aria-label="Reality checks done today" :aria-valuenow="pct" aria-valuemin="0" aria-valuemax="100"><i :style="{ width: pct + '%' }" /></div>
      <template v-if="lesson && items.length">
        <div class="hsub"><span class="t">Today's practice</span><span class="tiny">{{ practice }}</span></div>
        <div class="tcheck">
          <button v-for="it in items" :key="it.id" type="button" class="tck" :class="{ on: !!it.row }" role="checkbox" :aria-checked="!!it.row"
            :disabled="tick.busy.value" @click="tick.run(it.id, !it.row, it.row)">
            <span class="box"><Icon v-if="it.row" name="check" :size="14" /></span><span class="txt">{{ it.text }}</span>
          </button>
        </div>
        <router-link :to="{ path: '/train', query: { lesson: lesson.id } }" class="lnk inl tiny hmore">Lesson: {{ lesson.title }}</router-link>
      </template>
    </div>
  </section>
</template>
