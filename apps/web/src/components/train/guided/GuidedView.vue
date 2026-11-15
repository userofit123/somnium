<script setup lang="ts">
// A guided mode (PLAN.md §6.3, LDJ-25), opened as /train/guided/<mode>: a calm full screen on the dim night surface
// (--sdim tokens), large text, one primary button at the bottom, the sources a tap away. Close returns to where it was
// opened from; opened directly (a reminder), to the Train tab it lives on.
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import "../../../styles/components/guided.css";
import Icon from "../../Icon.vue";
import { vTrap } from "../../../core/focusTrap";
import SourceSheet from "../../learn/SourceSheet.vue";
import { useSettings } from "../../../api/queries";
import { goBack } from "../../../core/leave";
import WbtbPlanner from "./WbtbPlanner.vue";
import ImUp from "./ImUp.vue";
import MildFlow from "./MildFlow.vue";
import SsildTimer from "./SsildTimer.vue";
import WildTimer from "./WildTimer.vue";
import SoundCue from "./SoundCue.vue";
import CatPlan from "./CatPlan.vue";
import BedtimeRoutine from "./BedtimeRoutine.vue";

export type GuidedMode = "bedtime" | "wbtb" | "up" | "mild" | "ssild" | "wild" | "cue" | "cat";
const props = defineProps<{ mode: GuidedMode }>();
const NAMES: Record<GuidedMode, string> = { bedtime: "Bedtime", wbtb: "Wake back to bed (WBTB)", up: "I'm awake at the alarm", mild: "Remember to notice (MILD)", ssild: "Senses cycle (SSILD)", wild: "Fall asleep aware (WILD)", cue: "Sound cue", cat: "Shifted wake-up (CAT)" };
const router = useRouter();
const cite = ref<string[] | null>(null);
// sound cue is an optional feature: absent while off, even by its address (Train sends it back; this never shows another
// screen under its name meanwhile)
const settings = useSettings();
const cueOn = computed(() => !!settings.value.features.soundCue);
const shown = computed((): GuidedMode | null => (props.mode === "cue" && !cueOn.value ? null : props.mode));
// the header and the accessible name follow the screen actually shown
const name = computed(() => (shown.value ? NAMES[shown.value] : ""));
const close = () => goBack(router, ["bedtime", "wbtb", "up", "mild"].includes(props.mode) ? "/train/tonight" : "/train/techniques");
// one mode handing over to the next (I'm up → MILD) takes this one's place, so Close still returns to where it began
const go = (m: GuidedMode) => router.replace(`/train/guided/${m}`);
const running = ref(false);
</script>

<template>
  <div v-if="shown" v-trap class="gd" :class="{ run: running }" role="dialog" aria-modal="true" :aria-label="name">
    <div class="gtop">
      <button type="button" class="ib plain sm" aria-label="Close" @click="close"><Icon name="close" :size="18" /></button>
      <span class="grow" />
      <span class="gname">{{ name }}</span>
    </div>
    <BedtimeRoutine v-if="mode === 'bedtime'" @cite="cite = $event" @go="go" @running="running = $event" />
    <WbtbPlanner v-else-if="mode === 'wbtb'" @cite="cite = $event" @done="close" />
    <ImUp v-else-if="mode === 'up'" @cite="cite = $event" @go="go" />
    <MildFlow v-else-if="mode === 'mild'" @cite="cite = $event" @done="close" />
    <SsildTimer v-else-if="mode === 'ssild'" @cite="cite = $event" @running="running = $event" @done="close" />
    <WildTimer v-else-if="mode === 'wild'" @cite="cite = $event" @running="running = $event" @done="close" />
    <SoundCue v-else-if="mode === 'cue'" @cite="cite = $event" @running="running = $event" @done="close" />
    <CatPlan v-else-if="mode === 'cat'" @cite="cite = $event" @done="close" />
    <SourceSheet v-if="cite" :ids="cite" @close="cite = null" />
  </div>
</template>
