<script setup lang="ts">
// "Add a technique" on Train > Tonight (LDJ-96): every technique by family, strongest evidence first, each with its
// evidence badge, so planning doesn't mean scrolling the library. WBTB is left out: it is planned with its alarm (the
// WBTB planner). Tapping one adds it to tonight's plan through the outbox (api/train.ts) and closes the sheet.
import { computed } from "vue";
import { families, inFamily, evidenceLabel } from "@somnium/knowledge/techniques";
import { planTonight } from "../../api/train";
import { useChange } from "../../api/queries";
import Sheet from "../Sheet.vue";

const props = defineProps<{ planned: readonly string[]; titleOf: (id: string) => string }>();
const emit = defineEmits<{ close: [] }>();
const choices = computed(() => families.map((f) => ({
  ...f,
  items: inFamily(f.id).filter((t) => t.id !== "wbtb" && !props.planned.includes(t.id)).map((t) => ({ id: t.id, evidence: t.evidence, title: props.titleOf(t.id) })),
})).filter((f) => f.items.length));
const add = useChange(async (id: string) => { await planTonight(id, true); emit("close"); }, ["journal", "train", "home"]);
</script>

<template>
  <Sheet title="Add a technique" @close="emit('close')">
    <div v-for="f in choices" :key="f.id" class="tpfam">
      <div class="tiny tpfh">{{ f.title }}</div>
      <button v-for="c in f.items" :key="c.id" type="button" class="li click" :disabled="add.busy.value" @click="add.run(c.id)">
        <span class="grow t">{{ c.title }}</span>
        <span class="tev" :class="c.evidence">{{ evidenceLabel[c.evidence] }}</span>
      </button>
    </div>
    <p v-if="!choices.length" class="tiny">Every technique is in tonight's plan.</p>
  </Sheet>
</template>
