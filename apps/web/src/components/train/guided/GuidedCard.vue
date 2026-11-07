<script setup lang="ts">
// Train's entry points to the guided modes (LDJ-25). The WBTB row shows tonight's alarm when one is planned, and
// "I'm up" comes first while that alarm is near (from an hour before it to four hours after).
import { computed } from "vue";
import Icon from "../../Icon.vue";
import type { GuidedMode } from "./GuidedView.vue";
import { useSettings } from "../../../api/queries";
import { catPlan } from "../../../native/reminders";
import { flushCueLog } from "./cueSession";
const settings = useSettings();
// a sound cue session that ended behind the app lock logs on the night now (cueSession.ts)
void flushCueLog();
const props = defineProps<{ wakeAt: string | null }>();
const alarm = computed(() => (props.wakeAt ? new Date(props.wakeAt) : null));
const near = computed(() => { const a = alarm.value?.getTime(); return !!a && Date.now() > a - 3_600_000 && Date.now() < a + 4 * 3_600_000; });
const hm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
const rows = computed(() => {
  const r: { mode: GuidedMode; t: string; s: string; icon: string }[] = [
    { mode: "wbtb", t: "WBTB planner", s: alarm.value ? `Alarm at ${hm(alarm.value)}` : "Bedtime and sleep cycles give the alarm", icon: "clock" },
    { mode: "up", t: "I'm up", s: "Minutes awake, then back to bed", icon: "refresh" },
    { mode: "mild", t: "MILD at bedtime", s: "Your dream sign and the intention", icon: "moon" },
    { mode: "ssild", t: "SSILD timer", s: "Sight, sound, body cycles", icon: "layers" },
    { mode: "wild", t: "WILD relaxation", s: "A soft timer", icon: "target" },
    { mode: "drill", t: "Reality check drill", s: "Do a check now", icon: "check" },
    { mode: "cat", t: "CAT plan", s: catPlan() ? "Running · the morning alarms" : "Wake 90 minutes early, then alternate days", icon: "clock" },
  ];
  // LDJ-48: only while switched on in Settings → Features
  if (settings.value.features.soundCue) r.push({ mode: "cue", t: "Sound cue", s: "Train a tone, then hear it while you sleep", icon: "moon" });
  if (near.value) r.unshift(...r.splice(1, 1));
  return r;
});
</script>

<template>
  <section class="tguided">
    <div class="sh"><h2>Guided</h2></div>
    <div class="card flush">
      <router-link v-for="r in rows" :key="r.mode" :to="{ path: '/train', query: { guided: r.mode } }" class="li">
        <Icon :name="r.icon" :size="18" />
        <div class="grow"><div class="t">{{ r.t }}</div><div class="s">{{ r.s }}</div></div>
        <Icon name="right" :size="16" />
      </router-link>
    </div>
  </section>
</template>
