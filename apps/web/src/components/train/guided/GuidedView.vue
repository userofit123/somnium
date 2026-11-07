<script setup lang="ts">
// A guided mode (PLAN.md §6.4, LDJ-25), opened as /train?guided=<mode>: a calm full screen on the dim night surface
// (--sdim tokens), large text, one primary button at the bottom, the sources a tap away. Close goes back to Train.
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import "../../../styles/components/guided.css";
import Icon from "../../Icon.vue";
import SourceSheet from "../../learn/SourceSheet.vue";
import { useSettings } from "../../../api/queries";
import WbtbPlanner from "./WbtbPlanner.vue";
import ImUp from "./ImUp.vue";
import MildFlow from "./MildFlow.vue";
import SsildTimer from "./SsildTimer.vue";
import WildTimer from "./WildTimer.vue";
import CheckDrill from "./CheckDrill.vue";
import SoundCue from "./SoundCue.vue";
import CatPlan from "./CatPlan.vue";

export type GuidedMode = "wbtb" | "up" | "mild" | "ssild" | "wild" | "drill" | "cue" | "cat";
const props = defineProps<{ mode: GuidedMode }>();
const NAMES: Record<GuidedMode, string> = { wbtb: "WBTB planner", up: "I'm up", mild: "MILD", ssild: "SSILD", wild: "WILD", drill: "Reality check", cue: "Sound cue", cat: "CAT plan" };
const router = useRouter();
const cite = ref<string[] | null>(null);
const name = computed(() => NAMES[props.mode]);
const close = () => router.push("/train");
const go = (m: GuidedMode) => router.push({ path: "/train", query: { guided: m } });
const running = ref(false);
// sound cue is an optional feature: absent while off, even by its address
const settings = useSettings();
const cueOn = computed(() => !!settings.value.features.soundCue);
</script>

<template>
  <div class="gd" :class="{ run: running }" role="dialog" aria-modal="true" :aria-label="name">
    <div class="gtop">
      <button type="button" class="gx" @click="close"><Icon name="close" :size="18" /> Close</button>
      <span class="grow" />
      <span class="gname">{{ name }}</span>
    </div>
    <WbtbPlanner v-if="mode === 'wbtb'" @cite="cite = $event" @done="close" />
    <ImUp v-else-if="mode === 'up'" @cite="cite = $event" @go="go" />
    <MildFlow v-else-if="mode === 'mild'" @cite="cite = $event" @done="close" />
    <SsildTimer v-else-if="mode === 'ssild'" @cite="cite = $event" @running="running = $event" @done="close" />
    <WildTimer v-else-if="mode === 'wild'" @cite="cite = $event" @running="running = $event" @done="close" />
    <SoundCue v-else-if="mode === 'cue' && cueOn" @cite="cite = $event" @running="running = $event" @done="close" />
    <CatPlan v-else-if="mode === 'cat'" @cite="cite = $event" @done="close" />
    <CheckDrill v-else @done="close" />
    <SourceSheet v-if="cite" :ids="cite" @close="cite = null" />
  </div>
</template>
