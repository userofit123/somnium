<script setup lang="ts">
// Train's entry points to the guided modes (LDJ-25), in two groups (PLAN.md §6.3): the bedtime starts on the Tonight tab
// (the bedtime routine, LDJ-167, then MILD, SSILD, WILD, "I'm awake at the alarm" for the WBTB wake, then the Evening review as the closing step, LDJ-96) and the
// tools on the Techniques tab (the WBTB planner among them; a reality check is logged from the + sheet and the Today
// checklist (/check), LDJ-118, not from here; Tonight's plan shows its alarm with Change). The WBTB row
// shows tonight's alarm when one is planned, and "I'm awake at the alarm" comes first while that alarm is near (from an hour before
// it to four hours after).
import { computed } from "vue";
import Icon from "../../Icon.vue";
import type { GuidedMode } from "./GuidedView.vue";
import { useSettings } from "../../../api/queries";
import { catPlan } from "../../../native/reminders";
import { flushCueLog } from "./cueSession";
const settings = useSettings();
// a sound cue session that ended behind the app lock logs on the night now (cueSession.ts)
void flushCueLog();
const props = defineProps<{ wakeAt: string | null; group: "tonight" | "tools" }>();
// SSILD and WILD are bedtime starts and tools both (PLAN.md §6.3), so they are in both groups
const GROUPS: Record<"tonight" | "tools", GuidedMode[]> = { tonight: ["bedtime", "up", "mild", "ssild", "wild"], tools: ["wbtb", "ssild", "wild", "cat", "cue"] };
const alarm = computed(() => (props.wakeAt ? new Date(props.wakeAt) : null));
const near = computed(() => { const a = alarm.value?.getTime(); return !!a && Date.now() > a - 3_600_000 && Date.now() < a + 4 * 3_600_000; });
const hm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
const rows = computed(() => {
  const r: { mode: GuidedMode; t: string; s: string; icon: string }[] = [
    { mode: "bedtime", t: "Bedtime routine", s: "Intention, dream sign and plan, about 2 minutes", icon: "moon" },
    // plain names first, the acronym second (LDJ-168): a newcomer knows what each opens without reading Learn
    { mode: "wbtb", t: "Wake back to bed (WBTB)", s: alarm.value ? `Alarm at ${hm(alarm.value)}` : "An alarm for a short wake late in the night", icon: "clock" },
    { mode: "up", t: "I'm awake at the alarm", s: "Minutes awake, then back to bed", icon: "refresh" },
    { mode: "mild", t: "Remember to notice (MILD)", s: "Your dream sign and the intention, as you fall asleep", icon: "moon" },
    { mode: "ssild", t: "Senses cycle (SSILD)", s: "Short cycles through sight, sound and body", icon: "layers" },
    { mode: "wild", t: "Fall asleep aware (WILD)", s: "A soft timer to relax while staying a little aware", icon: "target" },
    { mode: "cat", t: "Shifted wake-up (CAT)", s: catPlan() ? "Running · the morning alarms" : "Wake 90 minutes early, then alternate days", icon: "clock" },
  ];
  // LDJ-48: only while switched on in Settings → Features
  if (settings.value.features.soundCue) r.push({ mode: "cue", t: "Sound cue", s: "Train a tone, then hear it while you sleep", icon: "moon" });
  if (near.value) r.unshift(...r.splice(2, 1));
  return r.filter((x) => GROUPS[props.group].includes(x.mode)).map((x) => ({ ...x, to: "/train/guided/" + x.mode }));
});
// the closing step of the evening (PLAN.md §6.3)
const review = { to: "/train/review", t: "Evening review", s: "The last step before sleep", icon: "check" };
</script>

<template>
  <section class="tguided">
    <div class="sh"><h2>{{ group === "tonight" ? "Guided bedtime" : "Guided tools" }}</h2></div>
    <div class="card flush">
      <router-link v-for="r in group === 'tonight' ? [...rows, review] : rows" :key="r.to" :to="r.to" class="li">
        <Icon :name="r.icon" :size="18" />
        <div class="grow"><div class="t">{{ r.t }}</div><div class="s">{{ r.s }}</div></div>
        <Icon name="right" :size="16" />
      </router-link>
    </div>
  </section>
</template>
