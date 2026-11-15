// The morning's night question (LDJ-79, components/journal/NightCheckIn.vue): Yes or No to each of last night's
// techniques, and how long it took to fall asleep after MILD or SSILD. Asked once per night on Home's This morning card
// and the Journal's last-night strip. A "No" leaves nothing on the night, so that it was answered (or skipped) is
// remembered on this device: night ids only, nothing personal.
import { ref } from "vue";
import { putNight } from "./journal";
import { readJson, writeJson } from "../core/prefs";

const ASKED_KEY = "somniumNightAsked";
export const askedNights = ref<string[]>(readJson<string[]>(ASKED_KEY, []));
export function markAsked(nightId: string) {
  if (askedNights.value.includes(nightId)) return;
  // the last few weeks are plenty: the question is only ever about last night
  askedNights.value = [...askedNights.value, nightId].slice(-60);
  writeJson(ASKED_KEY, askedNights.value);
}

// One night's answers are saved one after another: each tap sends the whole techniques list, so two quick taps sent
// side by side could reach the server in the wrong order and the older list would win.
const turns = new Map<string, Promise<unknown>>();
function inTurn<T>(nightId: string, f: () => Promise<T>): Promise<T> {
  const next = (turns.get(nightId) ?? Promise.resolve()).catch(() => undefined).then(f);
  turns.set(nightId, next);
  void next.catch(() => undefined).finally(() => { if (turns.get(nightId) === next) turns.delete(nightId); });
  return next;
}

/**
 * Yes or No to one technique on a night: techniques_done gains or loses it (plain, through the outbox). `done` answers
 * the list as the answers saved so far left it (read when this answer's turn comes), and the new list is returned.
 * A "No" to WBTB also clears wbtb_used, which "I'm up" sets: otherwise the night would say both.
 */
export function answerTechnique(nightId: string, done: () => readonly string[], technique: string, did: boolean): Promise<string[]> {
  return inTurn(nightId, async () => {
    const cur = [...done()];
    const next = did ? (cur.includes(technique) ? cur : [...cur, technique]) : cur.filter((t) => t !== technique);
    if (next.length !== cur.length) await putNight(nightId, { techniquesDone: next, ...(technique === "wbtb" && !did ? { wbtbUsed: false } : {}) });
    return next;
  });
}

/** How long it took to fall asleep after the technique (sealed: see putNight), in turn with the night's other answers. */
export const answerAsleep = (nightId: string, minutes: number | null) => inTurn(nightId, () => putNight(nightId, { minutesToSleep: minutes }));
