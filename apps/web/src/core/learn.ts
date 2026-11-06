// Learn state kept with the settings (reading progress, last article, "Where am I" answers). Nothing here
// holds dream content, so it syncs in the clear like the other settings.
import { computed } from "vue";
import { useSettings, saveSettings } from "../api/queries";
import { localYmd } from "./format";
import { markRead, type ReadMap } from "@somnium/knowledge/learn";
import { addAnswer, type AssessmentId } from "@somnium/knowledge/assessments";

export function useLearn() {
  const settings = useSettings();
  const read = computed<ReadMap>(() => settings.value.learn.read);
  const last = computed(() => settings.value.learn.last);
  const answers = computed(() => settings.value.learn.assessments);
  return { read, last, answers };
}

export function recordRead(read: ReadMap, id: string) {
  const next = markRead(read, id, localYmd(new Date()));
  if (next !== read) void saveSettings({ learn: { read: { [id]: next[id] } } }, { quiet: true });
}

export function recordOpened(current: string, id: string) {
  if (current !== id) void saveSettings({ learn: { last: id } }, { quiet: true });
}

export function saveAnswer(id: AssessmentId, list: { date: string; value: number }[], value: number) {
  const next = addAnswer(list, { date: localYmd(new Date()), value });
  return saveSettings({ learn: { assessments: { [id]: next } } });
}
