// The morning's night question (LDJ-79, components/journal/NightCheckIn.vue): Yes or No to each of last night's
// techniques, and how long it took to fall asleep after MILD or SSILD. Asked once per night on Home's This morning card
// and the Journal's last-night strip. A "No" leaves nothing on the night, so that it was answered (or skipped) is
// remembered on this device: night ids only, nothing personal.
import { ref } from "vue";
import { putNight, type NightRow } from "./journal";
import { readJson, writeJson } from "../core/prefs";

const ASKED_KEY = "somniumNightAsked";
export const askedNights = ref<string[]>(readJson<string[]>(ASKED_KEY, []));
export function markAsked(nightId: string) {
  if (askedNights.value.includes(nightId)) return;
  // the last few weeks are plenty: the question is only ever about last night
  askedNights.value = [...askedNights.value, nightId].slice(-60);
  writeJson(ASKED_KEY, askedNights.value);
}

/** Yes or No to one technique on a night: techniques_done gains or loses it (plain, through the outbox). */
export async function answerTechnique(night: Pick<NightRow, "id" | "techniquesDone">, technique: string, did: boolean) {
  const cur = night.techniquesDone ?? [];
  const next = did ? (cur.includes(technique) ? cur : [...cur, technique]) : cur.filter((t) => t !== technique);
  if (next.length !== cur.length) await putNight(night.id, { techniquesDone: next });
}

/** How long it took to fall asleep after the technique (sealed: see putNight). */
export const answerAsleep = (nightId: string, minutes: number | null) => putNight(nightId, { minutesToSleep: minutes });
