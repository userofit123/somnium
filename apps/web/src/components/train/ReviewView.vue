<script setup lang="ts">
// The evening review (LDJ-26, LDJ-120): the closing step of Train > Tonight, also opened from the Today checklist after
// 18:00. One short screen: tonight's intention (set or changed right here, the same sealed field as Tonight's plan),
// your top dream sign with the check paired with it, and tonight's techniques. "Done" ticks the habit and returns to
// where the review was opened from.
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { eveningOf } from "@somnium/shared";
import { tonightNight, tonightDate, tickPractice } from "../../api/train";
import { saveIntention } from "../../api/home";
import { useChange } from "../../api/queries";
import { goBack, backLabel } from "../../core/leave";
import Icon from "../Icon.vue";
import WhyNote from "../learn/WhyNote.vue";
import { useHabits } from "./useHabits";
import "../../styles/components/tonight.css";

const props = defineProps<{ titleOf: (id: string) => string }>();
const router = useRouter();
const h = useHabits();
// the same night Train > Tonight plans (before 05:00, the night you are in)
const date = tonightDate();
const night = computed(() => tonightNight(h.j.nights.data.value, date));
const planned = computed(() => (night.value?.techniquesPlanned ?? []).map((id) => ({ id, title: props.titleOf(id) })));

// ---- the intention, inline (as TonightPlan edits it): sealed on the night (api/home.ts)
const text = ref(night.value?.intention ?? "");
const editing = ref(false);
watch(() => night.value?.intention, (v) => { if (!editing.value) text.value = v ?? ""; });
const save = useChange(async () => { await saveIntention(date, text.value); editing.value = false; }, ["journal", "home"]);
const cancel = () => { text.value = night.value?.intention ?? ""; editing.value = false; };

// Back and Done return to where the review was opened from (Train > Tonight, the checklist, Home); opened directly, to Train
const back = backLabel(router, "Train");
// the review belongs to the evening the night began: done at 01:00, it ticks yesterday's (as Home's step reads it)
const done = useChange(async () => {
  const evening = eveningOf(h.today.value, new Date().getHours());
  await tickPractice("habit:review", evening, true, h.rowAt("habit:review", evening));
  goBack(router, "/train/tonight");
}, ["practice"]);
// the check paired with the top sign, logged against that sign (CheckScreen reads kind and sign)
const sign = h.topSign;
const doCheck = () => { const s = sign.value; if (s?.check) void router.push({ name: "check", query: { kind: s.check.id, sign: s.id } }); };
</script>

<template>
  <div class="tview tplan">
    <div class="ph"><div><button type="button" class="back" @click="goBack(router, '/train/tonight')"><Icon name="left" :size="16" /><span>{{ back }}</span></button><h1>Evening review</h1></div><div class="acts"><button class="btn s keep" :disabled="done.busy.value" @click="done.run()">Done</button></div></div>
    <WhyNote id="review" class="rv-why" />
    <div class="card">
      <div v-if="!editing" class="tprow">
        <div class="grow"><div class="t">Tonight's intention</div><div class="tiny tpx">{{ night?.intention || "None set" }}</div></div>
        <button type="button" class="btn tonal s" @click="editing = true"><Icon name="edit" :size="16" />{{ night?.intention ? "Change" : "Set an intention" }}</button>
      </div>
      <form v-else class="tpedit" @submit.prevent="save.run()">
        <label class="t" for="r-intention">Tonight's intention</label>
        <input id="r-intention" v-model="text" type="text" maxlength="200" placeholder="Next time I dream, I will notice I am dreaming" autocomplete="off" @keydown.esc="cancel" />
        <div class="tprow"><span class="grow" /><button type="button" class="btn tonal s" @click="cancel">Cancel</button><button type="submit" class="btn o s" :disabled="save.busy.value">Save</button></div>
      </form>

      <div class="tpsec">
        <div class="t">Your top dream sign</div>
        <template v-if="sign">
          <div class="tiny"><router-link :to="'/signs/' + sign.id">{{ sign.name }}</router-link></div>
          <div v-if="sign.check" class="tprow"><div class="grow tiny">Its check: {{ sign.check.name }}</div><button type="button" class="btn tonal s" @click="doCheck">Do this check</button></div>
        </template>
        <div v-else class="tiny">None yet. Dream signs appear as you log dreams.</div>
      </div>

      <div class="tpsec">
        <div class="tprow"><div class="t grow">Tonight's techniques</div><router-link to="/train/tonight" class="btn tonal s">{{ planned.length ? "Change" : "Plan tonight" }}</router-link></div>
        <div v-if="planned.length" class="tplist">
          <div v-for="p in planned" :key="p.id" class="li tpli"><Icon name="moon" :size="18" /><router-link :to="'/train/technique/' + p.id" class="grow t tpname">{{ p.title }}</router-link></div>
        </div>
        <div v-else class="tiny">None planned</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* the first-time note sits between the header and the card: the gap between blocks */
.rv-why { margin-bottom: var(--spg); }
</style>
