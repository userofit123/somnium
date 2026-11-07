<script setup lang="ts">
// Settings card for the optional local text model (LDJ-42): the address of an Ollama computer the person runs, a model
// name, the warning (ticked once) and a Test. The desktop app keeps it, in this account's own record on this computer
// (main.ts localModel:set), and calls only the address saved there. Shown under Features once the feature is on.
import { computed, onMounted, ref } from "vue";
import { LOCAL_MODEL_WARNING, checkModelAddress } from "@somnium/shared";
import { loadLocalModel, localModel, modelPlace, saveLocalModel, testModel } from "../../core/localModel";

const place = modelPlace();
const url = ref(localModel.url), model = ref(localModel.model);
onMounted(async () => { if (place !== "desktop") return; await loadLocalModel(); url.value = localModel.url; model.value = localModel.model; });
const check = computed(() => (url.value.trim() ? checkModelAddress(url.value) : null));
const result = ref(""), testing = ref(false);
// an address outside this computer and the home network is never saved (the desktop app refuses it too)
async function save(p: { ack?: boolean } = {}) {
  result.value = "";
  if (check.value && !check.value.ok) return false;
  try { await saveLocalModel({ url: check.value?.ok ? check.value.origin : "", model: model.value.trim(), ...p }); if (check.value?.ok) url.value = localModel.url; return true; }
  catch (e) { result.value = e instanceof Error ? e.message : "Not saved"; return false; }
}
async function test() {
  if (!(await save())) return;
  testing.value = true; result.value = "";
  try {
    const r = await testModel();
    result.value = r.has ? "Connected, and that model is there." : r.names.length ? `Connected, but there is no model with that name. Found: ${r.names.slice(0, 6).join(", ")}` : "Connected, but it has no models yet.";
  } catch (e) { result.value = e instanceof Error ? e.message : "Could not connect"; } finally { testing.value = false; }
}
</script>

<template>
  <div class="sh"><h2>Local AI model</h2></div>
  <div class="card">
    <div class="li"><div class="grow"><div class="t">{{ place === "desktop" ? "Your own Ollama address" : place === "android" ? "Not yet on Android" : "Available in the desktop and Android apps" }}</div>
      <div class="s">{{ place === "desktop" ? "Used only when you ask, from a dream's ⋮ menu. Never a cloud service, never a key. Saved for this account on this computer only." : place === "android" ? "The Android app can't reach your own computer for this yet." : "The web page can only talk to its own server, so it can't call your computer. Android support is planned." }}</div></div></div>
    <template v-if="place === 'desktop'">
      <label class="li"><div class="grow"><div class="t">Address</div><div class="s">This computer or your home network only, for example http://192.168.1.5:11434</div></div>
        <input v-model="url" class="inp" inputmode="url" autocomplete="off" spellcheck="false" placeholder="http://192.168.1.5:11434" @change="save()" /></label>
      <div v-if="check && !check.ok" class="li"><div class="s neg">{{ check.error }}</div></div>
      <div v-else-if="check?.ok && check.warning" class="li"><div class="s">{{ check.warning }}</div></div>
      <label class="li"><div class="grow"><div class="t">Model name</div><div class="s">As Ollama lists it, for example llama3.2</div></div>
        <input v-model="model" class="inp" autocomplete="off" spellcheck="false" placeholder="llama3.2" @change="save()" /></label>
      <label class="tgl"><div class="grow"><div class="t">{{ LOCAL_MODEL_WARNING }}</div></div><span class="tg"><input type="checkbox" :checked="localModel.ack" @change="save({ ack: ($event.target as HTMLInputElement).checked })" /></span></label>
      <div class="li"><div class="grow"><div class="s">{{ result || "Test asks the address for its model list; no dream text is sent." }}</div></div><button class="btn s" :disabled="testing || !check?.ok" @click="test">{{ testing ? "Testing…" : "Test" }}</button></div>
    </template>
  </div>
</template>
