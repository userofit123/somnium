// Learn state kept with the settings (reading progress, last article, "Where am I" answers). Nothing here
// holds dream content, so it syncs in the clear like the other settings.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, type Ref } from "vue";
import { useSettings, saveSettings } from "../api/queries";
import { localYmd } from "./format";
import { markRead, togglePin, type ReadMap } from "@somnium/knowledge/learn";
import { addAnswer, type AssessmentId } from "@somnium/knowledge/assessments";

export function useLearn() {
  const settings = useSettings();
  const read = computed<ReadMap>(() => settings.value.learn.read);
  const last = computed(() => settings.value.learn.last);
  const pinned = computed<string[]>(() => settings.value.learn.pinned);
  const answers = computed(() => settings.value.learn.assessments);
  return { read, last, answers, pinned };
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

/** Marks an article read (today) or unread by hand. Unread is stored as "" because the settings merge cannot delete a key. */
export function setRead(id: string, on: boolean) {
  void saveSettings({ learn: { read: { [id]: on ? localYmd(new Date()) : "" } } }, { quiet: true });
}

export function togglePinned(pinned: readonly string[], id: string) {
  void saveSettings({ learn: { pinned: togglePin(pinned, id) } }, { quiet: true });
}

/** "Read" means scrolled to the end marker. A scroll listener, not an IntersectionObserver: a jump to the bottom (End key,
 *  a fling) can pass the marker between two frames, and it still counts. A short page that fits on screen counts once it
 *  has been shown for a moment. Re-arms when `id` changes. Returns the ref for the marker element. */
export function useReadAtEnd(id: () => string, read: Ref<ReadMap>) {
  const end = ref<HTMLElement | null>(null);
  let timer = 0, done = false;
  function check() {
    if (done || !end.value) return;
    if (end.value.getBoundingClientRect().top <= innerHeight) { done = true; recordRead(read.value, id()); removeEventListener("scroll", check); }
  }
  async function arm() {
    removeEventListener("scroll", check); done = false; clearTimeout(timer); await nextTick();
    addEventListener("scroll", check, { passive: true });
    timer = window.setTimeout(check, 1200);
  }
  onMounted(() => void arm());
  onBeforeUnmount(() => { removeEventListener("scroll", check); clearTimeout(timer); });
  return { end, arm };
}
