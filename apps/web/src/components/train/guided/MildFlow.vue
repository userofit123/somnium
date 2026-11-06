<script setup lang="ts">
// The MILD flow (PLAN.md §6.4, LDJ-25), worded as the Aspy 2017 instructions [D11] (RESEARCH.md Part D §1): recall a
// dream, say the sentence "next time I'm dreaming, I will remember that I'm dreaming" with meaning, and imagine being
// back in the dream and noticing something odd, here your top dream sign (signShortlist; its name is sealed, and this
// screen is behind the lock like all of Train). An edited intention is saved sealed on the night (api/home.ts). Ends
// with "Sleep now" and the five-minute finding [B37], as a finding, not a target.
import { computed, ref } from "vue";
import { signShortlist } from "@somnium/shared";
import { useSigns } from "../../signs/useSigns";
import { useJournal } from "../../../api/journal";
import { saveIntention } from "../../../api/home";
import { nightNowDate } from "../../../api/train";
import { toastError } from "../../../core/toast";
import { useWakeLock } from "./useGuided";
import Ev from "./Ev.vue";

const emit = defineEmits<{ cite: [ids: string[]]; done: [] }>();
/** Aspy 2017's sentence, as RESEARCH.md quotes it [D11]. */
const SENTENCE = "Next time I'm dreaming, I will remember that I'm dreaming.";
const j = useJournal();
const { elements, stats, dreams, today } = useSigns();
const top = computed(() => signShortlist(elements.value, stats.value, dreams.value, [], today.value, 1)[0]?.element.name ?? null);
const date = nightNowDate();
const night = computed(() => j.nights.data.value?.find((n) => n.date === date && !n.nap));
const saved = night.value?.intention?.trim() || "";
const text = ref(saved || SENTENCE);
const step = ref(0);
const STEPS = 4;
const wake = useWakeLock();
void wake.on();

const busy = ref(false), asleep = ref(false);
async function next() {
  if (step.value === 1 && text.value.trim() !== (saved || SENTENCE)) {
    busy.value = true;
    try { await saveIntention(date, text.value); } catch (e) { toastError(e); return; } finally { busy.value = false; }
  }
  if (step.value < STEPS - 1) { step.value++; return; }
  asleep.value = true;
  await wake.off();
}
</script>

<template>
  <template v-if="!asleep">
    <div class="gbody">
      <div class="gsteps" aria-hidden="true"><i v-for="i in STEPS" :key="i" :class="{ on: i - 1 === step }" /></div>
      <template v-if="step === 0">
        <h1>Remember a dream</h1>
        <p class="glead">Sit up with a light on and try to remember a dream from just before waking, or any recent dream.</p>
        <p class="gp">Go to the bathroom if you need to. Then turn the light off and lie down comfortably.</p>
      </template>
      <template v-else-if="step === 1">
        <h1>Your intention</h1>
        <p class="gp">Repeat this, putting meaning into the words:</p>
        <label class="glabel" for="g-intention">Intention</label>
        <textarea id="g-intention" v-model="text" class="gintent" rows="3" maxlength="200" />
        <Ev text="Aspy's study used this sentence word for word [D11]. Changing it saves it, sealed, as tonight's intention." @cite="emit('cite', $event)" />
      </template>
      <template v-else-if="step === 2">
        <h1>Picture it</h1>
        <p class="glead">At the same time, imagine being back in the dream you remembered and noticing something unusual or bizarre that makes you realise you are dreaming.</p>
        <div v-if="top" class="gbox"><div class="glabel">Your top dream sign</div><div class="gsign">{{ top }}</div><div class="gev">Picture noticing it, and knowing: this is a dream.</div></div>
        <p v-else class="gev">Your top dream sign shows here once the Journal has enough dreams to find one. Picture whatever would tell you it is a dream.</p>
      </template>
      <template v-else>
        <h1>Repeat until you sleep</h1>
        <p class="glead">Repeat the sentence and the picture until you fall asleep or the intention feels set. If your mind wanders, go back to it, so the last thing in your mind is the intention.</p>
        <p class="gp">{{ text }}</p>
      </template>
      <Ev text="Steps as given to the participants of the Australian study (Aspy 2017) [D11]." @cite="emit('cite', $event)" />
    </div>
    <div class="gfoot">
      <button class="btn" :disabled="busy" @click="next">{{ step < STEPS - 1 ? "Next" : "Sleep now" }}</button>
      <button v-if="step > 0" type="button" class="glink" @click="step--">Back</button>
    </div>
  </template>
  <template v-else>
    <div class="gbody">
      <h1>Sleep well</h1>
      <p class="glead">Put the phone away and let yourself drift off with the intention.</p>
      <Ev text="Attempts where people fell asleep within about 5 minutes of finishing MILD went with the most success, about 46% [B37]. It is a finding, not a target: don't rush, and don't worry if it takes longer [D11]." big @cite="emit('cite', $event)" />
    </div>
    <div class="gfoot"><button class="btn o" @click="emit('done')">Close</button></div>
  </template>
</template>
