<script setup lang="ts">
// Goals (optional, LDJ-41): one progress card each, read from the same nights and checks Home and Insights use
// (packages/shared/src/goals.ts). Progress is the one place to add, change and remove goals; Home shows the same
// goals as a compact pinned summary (`compact`) that links there. Shown only while Settings → Features → Goals is on.
import { computed, ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useRouter } from "vue-router";
import { GOAL_KIND_INFO, GOAL_KINDS, defaultGoalKind, goalProgress, periodDaysLeft, type Goal, type GoalKind, type RealityCheck } from "@somnium/shared";
import { api } from "../../api/client";
import { useJournal } from "../../api/journal";
import { useGoals, saveGoal, removeGoal } from "../../api/extras";
import { useSettings } from "../../api/queries";
import { toastError } from "../../core/toast";
import { localYmd } from "../../core/format";
import Icon from "../Icon.vue";
import Sheet from "../Sheet.vue";
import Menu from "../Menu.vue";
import NumStep from "../NumStep.vue";
import ProgressBar from "../ProgressBar.vue";

const props = defineProps<{ today: string; compact?: boolean }>();
const router = useRouter();
const j = useJournal();
const goals = useGoals();
const checks = useQuery({
  queryKey: ["checks", "goals", props.today],
  queryFn: () => api.get<RealityCheck[]>("/reality-checks", { from: new Date(props.today + "T00:00:00").toISOString(), limit: 500 }),
});
const rows = computed(() => (goals.data.value ?? []).map((g) => ({
  g, p: goalProgress(g, { today: props.today, nights: j.nights.data.value ?? [], checkDays: (checks.data.value ?? []).map((c) => localYmd(new Date(c.at))) }),
  left: periodDaysLeft(g.kind, props.today),
})));

const settings = useSettings();
const edit = ref<{ g?: Goal; kind: GoalKind; target: number } | null>(null);
// a new goal starts on the kind that fits the goal chosen in setup (LDJ-216); an existing one keeps its own
const open = (g?: Goal) => {
  const kind = g?.kind ?? defaultGoalKind(settings.value.setup?.goal);
  edit.value = { g, kind, target: g?.target ?? GOAL_KIND_INFO[kind].def };
};
const pick = (k: GoalKind) => { if (edit.value) { edit.value.kind = k; edit.value.target = GOAL_KIND_INFO[k].def; } };
async function save() {
  const e = edit.value; if (!e) return;
  try { await saveGoal(e.g, e.kind, e.target, GOAL_KIND_INFO[e.kind].period); edit.value = null; } catch (x) { toastError(x); }
}
const del = async (g: Goal) => { try { await removeGoal(g); } catch (x) { toastError(x); } };
</script>

<template>
  <section v-if="compact" class="hextra" data-testid="goals-pinned">
    <div v-if="rows.length" class="card goalc click" role="link" tabindex="0" @click="router.push('/progress')" @keydown.enter="router.push('/progress')">
      <div class="lbl hgap"><span class="bi"><Icon name="trophy" :size="16" /></span><span class="grow">Goals</span><span class="tiny">All goals</span><Icon name="right" :size="16" class="muted" /></div>
      <div v-for="r in rows" :key="r.g.id" class="goalc">
        <div class="goalh"><div class="grow t">{{ GOAL_KIND_INFO[r.g.kind].label }}</div><div class="tiny num">{{ r.p.line }}<template v-if="r.p.done"> · reached</template></div></div>
        <ProgressBar :percent="r.p.ratio * 100" :label="GOAL_KIND_INFO[r.g.kind].label" />
      </div>
    </div>
    <div v-else class="card">
      <div class="lbl hgap"><span class="bi"><Icon name="trophy" :size="16" /></span><span class="grow">Goals</span><button class="lnk" type="button" @click="router.push('/progress')">Set a goal</button></div>
      <div class="tiny">No goals yet. Add one in Progress.</div>
    </div>
  </section>
  <section v-else class="hextra" data-testid="goals">
    <!-- the header's link only once there is a goal: an empty list has its own button -->
    <div class="sh"><h2>Goals</h2><button v-if="rows.length" class="lnk" type="button" @click="open()">Add a goal</button></div>
    <div v-if="!rows.length" class="card empty"><Icon name="trophy" :size="34" /><b>No goals yet</b>A goal is one number you would like to reach, such as 5 nights with a dream a week.<br /><button class="btn tonal" type="button" @click="open()">Add a goal</button></div>
    <div v-for="r in rows" :key="r.g.id" class="card goalc">
      <div class="goalh"><div class="grow"><div class="t">{{ GOAL_KIND_INFO[r.g.kind].label }}</div><div class="tiny num">{{ r.p.line }}<template v-if="r.left != null && !r.p.done"> · {{ r.left }} {{ r.left === 1 ? "day" : "days" }} left</template><template v-if="r.p.done"> · reached</template></div></div>
        <Menu :items="[{ label: 'Change goal', icon: 'edit', run: () => open(r.g) }, { label: 'Remove goal', icon: 'trash', danger: true, run: () => del(r.g) }]" /></div>
      <ProgressBar :percent="r.p.ratio * 100" :label="GOAL_KIND_INFO[r.g.kind].label" />
    </div>
    <Sheet v-if="edit" :title="edit.g ? 'Change goal' : 'New goal'" @close="edit = null">
      <div class="fld"><label>What to count</label>
        <div class="list"><label v-for="k in GOAL_KINDS" :key="k" class="li click"><input type="radio" name="goalkind" :checked="edit.kind === k" @change="pick(k)" /><div class="grow"><div class="t">{{ GOAL_KIND_INFO[k].label }}</div></div></label></div></div>
      <div class="fld"><label>Target ({{ GOAL_KIND_INFO[edit.kind].unit }})</label><NumStep :value="edit.target" :min="1" :max="GOAL_KIND_INFO[edit.kind].max" @set="(v: number) => (edit!.target = v)" /></div>
      <div class="tiny">Counted from what you log: nights with a dream this week (Monday on), lucid dreams this calendar month, checks today, mornings in a row.</div>
      <div class="row end"><button class="btn" type="button" @click="save">Save goal</button></div>
    </Sheet>
  </section>
</template>

<style>
/* spacing from the density tokens, colours from the theme's (--s2 is a surface, not a size) */
.goalc { display: grid; gap: var(--lpy); }
.goalh { display: flex; align-items: center; gap: var(--lpy); }
</style>
