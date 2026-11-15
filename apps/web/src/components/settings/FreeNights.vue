<script setup lang="ts">
// "Nights I can sleep in" (LDJ-108): plain weekday chips for settings.sleep.freeNights, the evenings after which a
// lie-in is possible. Tonight's suggested plan puts WBTB only on these [B69]. Its own component so the first-run setup
// can ask it too (LDJ-180). Saves on every tap, like the other Settings rows.
import { computed } from "vue";
import { freeNightsOf, resolveFormats } from "@somnium/shared";
import { saveSettings, useSettings } from "../../api/queries";

const settings = useSettings();
const NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
// in the week order of Settings → Formats
const days = computed(() => { const f = resolveFormats(settings.value).firstDay; return [0, 1, 2, 3, 4, 5, 6].map((i) => (i + f) % 7); });
const on = computed(() => freeNightsOf(settings.value.sleep.freeNights));
function toggle(d: number) {
  const next = on.value.includes(d) ? on.value.filter((x) => x !== d) : [...on.value, d].sort((a, b) => a - b);
  void saveSettings({ sleep: { freeNights: next } });
}
</script>

<template>
  <div class="chips" role="group" aria-label="Nights I can sleep in">
    <button v-for="d in days" :key="d" type="button" class="fchip" :class="{ on: on.includes(d) }" :aria-pressed="on.includes(d)" :aria-label="LONG[d] + ' night'" @click="toggle(d)">{{ NAMES[d] }}</button>
  </div>
</template>
