<script setup lang="ts">
// A technique's evidence badge, where it comes from, and "Use tonight" (LDJ-128). The same card on the technique page
// in Train and on its article in Learn, so planning tonight never leaves the page you are reading.
import { computed } from "vue";
import { parseInline } from "@somnium/knowledge/markdown";
import { evidenceLabel, type Technique } from "@somnium/knowledge/techniques";
import LearnInline from "../learn/LearnInline.vue";
import Icon from "../Icon.vue";
import { planTonight, tonightNight, tonightDate } from "../../api/train";
import { useNights } from "../../api/journal";
import { useChange } from "../../api/queries";
import { toast } from "../../core/toast";
import "../../styles/components/train.css";

// Train already knows tonight's plan and passes it in; Learn leaves it out and it is read here
const props = defineProps<{ technique: Technique; planned?: boolean }>();
const emit = defineEmits<{ cite: [ids: string[]] }>();
const nights = props.planned === undefined ? useNights() : null;
const isPlanned = computed(() => props.planned ?? !!tonightNight(nights?.data.value, tonightDate())?.techniquesPlanned?.includes(props.technique.id));
const basis = computed(() => parseInline(props.technique.basis));
const plan = useChange((add: boolean) => planTonight(props.technique.id, add), ["journal", "train"]);
async function use(add: boolean) {
  // a failed save already shows its error (useChange's onError); the confirmation is only for a save that landed
  try { await plan.run(add); } catch { return; }
  toast(add ? "Added to tonight's plan" : "Removed from tonight's plan");
}
</script>

<template>
  <div class="tuse card">
    <div class="grow">
      <span class="tev" :class="technique.evidence">{{ evidenceLabel[technique.evidence] }}</span>
      <div class="tiny tbasis"><LearnInline :nodes="basis" @cite="emit('cite', $event)" /></div>
    </div>
    <button v-if="!isPlanned" class="btn" :disabled="plan.busy.value" @click="use(true)">Use tonight</button>
    <div v-else class="tplanned"><span class="tiny"><Icon name="check" :size="14" /> In tonight's plan</span><button class="lnk inl" :disabled="plan.busy.value" @click="use(false)">Remove</button></div>
  </div>
</template>
