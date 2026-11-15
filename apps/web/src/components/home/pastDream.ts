// "Not now" on Home's "From your journal" card (LDJ-161): the day it was put away, on this device. Only a date is kept,
// never which dream. Reactive, so Home drops the block at once; it comes back the next day.
import { ref } from "vue";
import { readJson, writeJson } from "../../core/prefs";

const KEY = "somniumPastDreamNotNow";
const day = ref(readJson<string>(KEY, ""));
export const pastDreamPutAway = (today: string) => day.value === today;
export function putPastDreamAway(today: string) { day.value = today; writeJson(KEY, today); }
