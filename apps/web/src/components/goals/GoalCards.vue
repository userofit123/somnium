<script setup lang="ts">
// Goals (optional, LDJ-41): one progress card each, read from the same nights and checks Home and Insights use
// (packages/shared/src/goals.ts). Used on Home and in Insights; shown only while Settings → Features → Goals is on.
import { computed, ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { GOAL_KIND_INFO, GOAL_KINDS, goalProgress, periodDaysLeft, type Goal, type GoalKind, type RealityCheck } from "@somnium/shared";
import { api } from "../../api/client";
import { useJournal } from "../../api/journal";
import { useGoals, saveGoal, removeGoal } from "../../api/extras";
import { toastError } from "../../core/toast";
import { localYmd } from "../../core/format";
import Sheet from "../Sheet.vue";
import Menu from "../Menu.vue";
import NumStep from "../NumStep.vue";

const props = defineProps<{ today: string }>();
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

const edit = ref<{ g?: Goal; kind: GoalKind; target: number } | null>(null);
const open = (g?: Goal) => (edit.value = { g, kind: g?.kind ?? "recall_per_week", target: g?.target ?? GOAL_KIND_INFO[g?.kind ?? "recall_per_week"].def });
const pick = (k: GoalKind) => { if (edit.value) { edit.value.kind = k; edit.value.target = GOAL_KIND_INFO[k].def; } };
async function save() {
  const e = edit.value; if (!e) return;
  try { await saveGoal(e.g, e.kind, e.target, GOAL_KIND_INFO[e.kind].period); edit.value = null; } catch (x) { toastError(x); }
}
const del = async (g: Goal) => { try { await removeGoal(g); } catch (x) { toastError(x); } };
</script>

<template>
  <section class="hextra" data-testid="goals">
    <div class="sh"><h2>Goals</h2><button class="lnk tiny" type="button" @click="open()">Add a goal</button></div>
    <div v-if="!rows.length" class="card empty sm">No goals yet. A goal is one number you would like to reach, such as 5 nights with a dream a week.</div>
    <div v-for="r in rows" :key="r.g.id" class="card goalc">
      <div class="goalh"><div class="grow"><div class="t">{{ GOAL_KIND_INFO[r.g.kind].label }}</div><div class="tiny num">{{ r.p.line }}<template v-if="r.left != null && !r.p.done"> · {{ r.left }} {{ r.left === 1 ? "day" : "days" }} left</template><template v-if="r.p.done"> · reached</template></div></div>
        <Menu :items="[{ label: 'Change goal', icon: 'edit', run: () => open(r.g) }, { label: 'Remove goal', icon: 'trash', danger: true, run: () => del(r.g) }]" /></div>
      <div class="goalbar" role="progressbar" :aria-valuenow="r.p.value" :aria-valuemax="r.p.target"><i :style="{ width: Math.round(r.p.ratio * 100) + '%' }" /></div>
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
.goalc { display: grid; gap: var(--s2, 8px); }
.goalh { display: flex; align-items: center; gap: var(--s2, 8px); }
.goalbar { height: 8px; border-radius: 99px; background: var(--s2, rgba(128,128,128,.2)); overflow: hidden; }
.goalbar > i { display: block; height: 100%; background: var(--acc); border-radius: inherit; }
</style>
