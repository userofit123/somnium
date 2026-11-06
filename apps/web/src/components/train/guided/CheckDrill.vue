<script setup lang="ts">
// The reality check drill (PLAN.md §6.4, LDJ-25): do one check now - pick it, read how (checks.json), then say what
// you found. It logs through the same path as /check (api/checks.ts logCheck: nothing sealed, safe while locked),
// as a check of your own (not prompted).
import { computed, ref } from "vue";
import type { CheckOutcome } from "@somnium/shared";
import { logCheck } from "../../../api/checks";
import { checkCatalog } from "../../../native/reminders";

const emit = defineEmits<{ done: [] }>();
const catalog = await checkCatalog();
const kind = ref(catalog[0]?.id ?? "nose-pinch");
const check = computed(() => catalog.find((c) => c.id === kind.value)!);
const done = ref<CheckOutcome | null>(null), busy = ref(false), err = ref("");
const count = ref(0);
async function pick(o: CheckOutcome) {
  if (busy.value) return;
  busy.value = true; err.value = "";
  try { await logCheck(kind.value, o, false); done.value = o; count.value++; }
  catch (e) { err.value = (e as Error).message || "It couldn't be saved"; }
  finally { busy.value = false; }
}
const LABEL: Record<CheckOutcome, string> = { awake: "Awake", unsure: "Not sure", dreaming: "Dreaming" };
</script>

<template>
  <template v-if="!done">
    <div class="gbody">
      <h1>Are you dreaming?</h1>
      <p class="glead">Ask it for real, do the check, then say what you found.</p>
      <div class="gchips" role="radiogroup" aria-label="Which check">
        <button v-for="c in catalog" :key="c.id" type="button" class="gchip" :class="{ on: c.id === kind }" role="radio" :aria-checked="c.id === kind" @click="kind = c.id">{{ c.name }}</button>
      </div>
      <p class="gp">{{ check.howTo }}</p>
      <p v-if="err" class="gev">{{ err }}</p>
    </div>
    <div class="gfoot">
      <button class="btn" :disabled="busy" @click="pick('awake')">Awake</button>
      <button class="btn o" :disabled="busy" @click="pick('unsure')">Not sure</button>
      <button class="btn o" :disabled="busy" @click="pick('dreaming')">Dreaming</button>
    </div>
  </template>
  <template v-else>
    <div class="gbody">
      <h1>{{ done === "dreaming" ? "You're dreaming" : "Logged" }}</h1>
      <p class="glead">{{ done === "dreaming" ? "Stay calm and look at your hands." : `${LABEL[done]} · ${check.name}` }}</p>
      <p class="gev">{{ count === 1 ? "1 check" : `${count} checks` }} in this drill.</p>
    </div>
    <div class="gfoot">
      <button class="btn" @click="done = null">Another check</button>
      <button type="button" class="glink" @click="emit('done')">Done</button>
    </div>
  </template>
</template>
