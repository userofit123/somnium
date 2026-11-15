// The course lesson you are on, its move-on rule and Move on, worked out once for Train · Today and Home's step
// (LDJ-107), so the two never differ. The lesson texts come in from the caller: Train imports them, Home loads them
// with its page.
import { computed, ref, watch } from "vue";
import { currentLesson, nextLesson, moveOn } from "@somnium/shared";
import type { Lesson } from "@somnium/knowledge/course";
import { useJournal } from "../../api/journal";
import { useTrain, setLesson } from "../../api/train";
import { localYmd } from "../../core/format";
import { useToday } from "../../core/today";
import { toastError } from "../../core/toast";

export function useLesson(findLesson: (id: string) => Lesson | undefined, practiceItemId: (lesson: string, index: number) => string) {
  const j = useJournal(), t = useTrain(), today = useToday();
  const rows = computed(() => t.course.data.value ?? []);
  const current = computed(() => currentLesson(rows.value));
  const lesson = computed(() => (current.value ? findLesson(current.value) ?? null : null));
  const row = computed(() => rows.value.find((r) => r.lessonId === current.value));
  const itemIds = computed(() => (lesson.value ? lesson.value.practice.map((_, i) => practiceItemId(lesson.value!.id, i)) : []));

  const rule = computed(() => {
    if (!lesson.value) return null;
    return moveOn(lesson.value.id, {
      today: today.value,
      // the lesson's fixed start (set once when it became active); a row from before it existed falls back to creation
      since: row.value ? localYmd(new Date(row.value.startedAt ?? row.value.createdAt)) : today.value,
      nights: j.nights.data.value ?? [],
      checkDays: (t.checks.data.value ?? []).map((c) => localYmd(new Date(c.at))),
      practice: t.practice.data.value ?? [],
      items: itemIds.value,
    });
  });

  // the lesson in front of you is the current one in course_progress: written once, so the rules know when it began
  let started = "";
  watch([() => t.course.isSuccess.value, current], ([ok, id]) => {
    if (!ok || !id || row.value?.state === "active" || started === id) return;
    started = id;
    setLesson(id, "active", row.value).catch(toastError);
  }, { immediate: true });

  // Move on: this lesson done, the next one active (its start is what the next rule counts from)
  const moving = ref(false);
  async function next() {
    if (!lesson.value) return;
    moving.value = true;
    try {
      const id = lesson.value.id, after = nextLesson(id);
      started = after ?? "";
      await setLesson(id, "done", row.value);
      if (after) await setLesson(after, "active", rows.value.find((r) => r.lessonId === after));
    } catch (e) { toastError(e); } finally { moving.value = false; }
  }

  return { rows, current, lesson, row, itemIds, rule, moving, next };
}
