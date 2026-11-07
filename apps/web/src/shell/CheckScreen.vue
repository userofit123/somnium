<script setup lang="ts">
// The screen a reminder opens (/check): which check, then Awake, Not sure or Dreaming. It opens over the lock screen,
// so it shows nothing from the journal and writes only what isn't sealed (api/checks.ts). A note is sealed: adding
// one goes to /check/note/:id, which is behind the lock like every other page.
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import type { CheckOutcome } from "@somnium/shared";
import { logCheck } from "../api/checks";
import { checkCatalog } from "../native/reminders";
import { lock } from "../core/lock";
import Icon from "../components/Icon.vue";

const route = useRoute(), router = useRouter();
const catalog = await checkCatalog();
const prompted = route.query.prompted === "1";
const kind = ref(catalog.some((c) => c.id === route.query.kind) ? String(route.query.kind) : "nose-pinch");
const check = computed(() => catalog.find((c) => c.id === kind.value)!);
const done = ref<{ id: string; outcome: CheckOutcome; queued: boolean } | null>(null);
const busy = ref(false), err = ref("");

async function pick(outcome: CheckOutcome) {
  if (busy.value) return;
  busy.value = true; err.value = "";
  try { done.value = { ...(await logCheck(kind.value, outcome, prompted)), outcome }; }
  catch (e) { err.value = (e as Error).message || "It couldn't be saved"; }
  finally { busy.value = false; }
}
// leaving: the lock screen comes back by itself if the app is locked (App.vue)
const close = () => router.replace(lock.locked ? "/" : "/train");
const addNote = () => router.replace(`/check/note/${done.value!.id}`);
</script>

<template>
  <div class="auth" role="main">
    <div class="card stack" style="width:min(440px,100%)">
      <!-- the answer replaces the buttons; say so to a screen reader, which would otherwise hear nothing -->
      <p class="sr" role="status">{{ !done ? "" : done.outcome === "dreaming" ? "You're dreaming. Stay calm and look at your hands." : done.queued ? "Logged. Saved on this device." : "Logged" }}</p>
      <template v-if="!done">
        <div>
          <h1 style="margin-top:0">Are you dreaming?</h1>
          <p class="muted" style="margin:0">Really check, then say what you found.</p>
        </div>
        <div class="chips" role="radiogroup" aria-label="Which check">
          <button v-for="c in catalog" :key="c.id" type="button" class="fchip" :class="{ on: c.id === kind }" role="radio" :aria-checked="c.id === kind" @click="kind = c.id">{{ c.name }}</button>
        </div>
        <p style="margin:0">{{ check.howTo }}</p>
        <div class="stack">
          <button class="btn lg block" :disabled="busy" @click="pick('awake')">Awake</button>
          <button class="btn lg block tonal" :disabled="busy" @click="pick('unsure')">Not sure</button>
          <button class="btn lg block tonal" :disabled="busy" @click="pick('dreaming')">Dreaming!</button>
        </div>
        <p v-if="err" class="err" role="alert" style="margin:0">{{ err }}</p>
        <button class="btn o s" type="button" @click="close">Cancel</button>
      </template>
      <template v-else>
        <div v-if="done.outcome === 'dreaming'">
          <h1 style="margin-top:0">You're dreaming.</h1>
          <p style="margin:0">Stay calm and look at your hands.</p>
        </div>
        <div v-else>
          <h1 style="margin-top:0">Logged</h1>
          <p class="muted" style="margin:0">{{ done.outcome === "awake" ? "Awake" : "Not sure" }} · {{ check.name }}</p>
        </div>
        <p v-if="done.queued" class="tiny" style="margin:0"><Icon name="refresh" :size="13" /> Saved on this device; it is sent when the server can be reached.</p>
        <button class="btn lg block" @click="close">Done</button>
        <button class="btn o s" type="button" @click="addNote">{{ lock.locked ? "Unlock to add a note" : "Add a note" }}</button>
      </template>
    </div>
  </div>
</template>
