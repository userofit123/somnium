<script setup lang="ts">
// The guided reality check (LDJ-112): what a reminder's tap opens when Guided checks is on. Three steps on one dark
// screen, about 15 seconds: (1) the paired test, (2) the memory test, (3) "you are awake, now imagine: if this were a
// dream, what would be different?", then Awake or Dreaming. Each step moves on by itself after 5 s, or on a tap.
// Why the three: Tholey's critical question paired with a real test [D6], recalling the last few minutes as "one of the
// most effective tests" [C4][D8], LaBerge's imagining step [C1][D1]; rote checks alone showed no benefit [B37][D12].
// Like /check it opens over the lock screen: the paired dream sign's name (sealed) is shown only while the journal is
// unlocked here, and only its id (plain) is logged with the check.
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { uuidv7 } from "@somnium/engine/sealed-api";
import type { CheckOutcome } from "@somnium/shared";
import { logCheck } from "../api/checks";
import { api } from "../api/client";
import { checkCatalog } from "../native/reminders";
import { keyring } from "../core/keyring";
import { lock } from "../core/lock";
import { readWhySeen } from "../core/seenOnDevice";
import Ev from "../components/train/guided/Ev.vue";
import SourceSheet from "../components/learn/SourceSheet.vue";
import WhyNote from "../components/learn/WhyNote.vue";
import Icon from "../components/Icon.vue";
import "../styles/components/guided.css";

const props = defineProps<{ kind: string; sign: string | null; prompted: boolean }>();
const emit = defineEmits<{ close: []; note: [id: string] }>();
const router = useRouter();
const catalog = await checkCatalog();
const check = computed(() => catalog.find((c) => c.id === props.kind) ?? catalog[0]!);

// the sign's name: only with the journal open on this device, never over the lock screen. The screen can stay up
// while the app locks itself (App.vue renders it ahead of LockScreen), so the name is hidden the moment the lock
// engages or the key closes, dropped from memory, and read again once the journal is opened again.
const keyOpen = ref(keyring.isOpen());
const offKey = keyring.onChange((open) => { keyOpen.value = open; });
const loaded = ref<string | null>(null);
const canShow = computed(() => !!props.sign && !lock.locked && keyOpen.value);
const signName = computed(() => (canShow.value ? loaded.value : null));
let reads = 0;
watch(canShow, (ok) => {
  const n = ++reads;
  if (!ok) { loaded.value = null; return; }
  api.get<{ name?: string | null }>(`/elements/${props.sign}`)
    .then((e) => { if (n === reads && canShow.value) loaded.value = e?.name || null; }).catch(() => {});
}, { immediate: true });

const STEP_MS = 5000, STEPS = 3;
const step = ref(0), cite = ref<string[] | null>(null);
let timer: ReturnType<typeof setTimeout> | null = null;
const arm = () => {
  if (timer) clearTimeout(timer);
  timer = step.value < STEPS && !cite.value ? setTimeout(next, STEP_MS) : null;
};
function next() { if (step.value < STEPS) step.value++; }
// a tap on the step moves on, except one on a source button inside it
const tap = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest("button, a")) next(); };
// reading a source holds the step; closing it starts the step's 5 s again
watch([step, cite], arm, { immediate: true });
onBeforeUnmount(() => { if (timer) clearTimeout(timer); offKey(); });

const done = ref<{ id: string; outcome: CheckOutcome; queued: boolean } | null>(null);
const busy = ref(false), err = ref("");
const toWrite = () => router.replace({ name: "journal-write", params: { id: uuidv7() }, query: { new: "1" } });
async function pick(outcome: CheckOutcome) {
  if (busy.value) return;
  busy.value = true; err.value = "";
  try {
    const r = await logCheck(props.kind, outcome, props.prompted, undefined, props.sign);
    // Dreaming: a lucid moment, so straight to writing it down (behind the lock, like every journal page); the first
    // time, with the journal open, a note on staying calm comes first (WhyNote, LDJ-157)
    if (outcome === "dreaming" && (lock.locked || readWhySeen().includes("dreaming"))) { toWrite(); return; }
    done.value = { ...r, outcome };
  } catch (e) { err.value = (e as Error).message || "It couldn't be saved"; }
  finally { busy.value = false; }
}
</script>

<template>
  <div class="gd" role="main">
    <div class="gtop">
      <button class="ib plain" type="button" aria-label="Close" @click="emit('close')"><Icon name="close" :size="20" /></button>
      <span class="grow" />
      <span v-if="!done && step < STEPS" class="gname">{{ step + 1 }} of {{ STEPS }}</span>
    </div>

    <template v-if="done?.outcome === 'dreaming'">
      <div class="gbody" role="status">
        <h1>You're dreaming.</h1>
        <WhyNote id="dreaming" />
      </div>
      <div class="gfoot">
        <button class="btn" @click="toWrite">Write it down</button>
      </div>
    </template>

    <template v-else-if="done">
      <div class="gbody" role="status">
        <h1>Logged</h1>
        <p class="glead">Awake · {{ check.name }}</p>
        <p v-if="done.queued" class="gev"><Icon name="refresh" :size="13" /> Saved on this device; it is sent when the server can be reached.</p>
      </div>
      <div class="gfoot">
        <button class="btn" @click="emit('close')">Done</button>
        <button type="button" class="glink" @click="emit('note', done.id)">{{ lock.locked ? "Unlock to add a note" : "Add a note" }}</button>
      </div>
    </template>

    <template v-else-if="step < STEPS">
      <!-- the whole step is the tap target: a tap moves on at once -->
      <div class="gbody gstep" aria-live="polite" @click="tap">
        <template v-if="step === 0">
          <h1>Are you dreaming right now?</h1>
          <p class="gp">{{ check.howTo }}</p>
          <Ev text="Ask it for real and do a real test: the question alone is not enough [D6]." @cite="cite = $event" />
        </template>
        <template v-else-if="step === 1">
          <h1>What happened in the last few minutes?</h1>
          <p class="gp">Anything odd? Any gap you can't account for?</p>
          <p v-if="signName" class="gp">Your dream sign: {{ signName }}. Is anything like that here?</p>
          <Ev text="Trying to remember what just happened is &quot;one of the most effective tests&quot; [C4][D8]." @cite="cite = $event" />
        </template>
        <template v-else>
          <h1>You are awake.</h1>
          <p class="gp">Now imagine: if this were a dream, what would be different?</p>
          <Ev text="Imagining it, once sure you are awake, is LaBerge's step for carrying the check into dreams [C1][D1]." @cite="cite = $event" />
        </template>
      </div>
      <div class="gfoot">
        <button class="btn o" type="button" @click="next">Next</button>
      </div>
    </template>

    <template v-else>
      <div class="gbody">
        <h1>What did you find?</h1>
        <p class="glead">{{ check.name }}</p>
        <!-- the first check: why it is done this way (shown only once the journal is open, never over the lock screen) -->
        <WhyNote id="check" />
        <p v-if="err" class="gev" role="alert">{{ err }}</p>
      </div>
      <div class="gfoot">
        <button class="btn" :disabled="busy" @click="pick('awake')">Awake</button>
        <button class="btn o" :disabled="busy" @click="pick('dreaming')">Dreaming</button>
      </div>
    </template>

    <SourceSheet v-if="cite" :ids="cite" @close="cite = null" />
  </div>
</template>

<style scoped>
.gstep { cursor: pointer; }
</style>
