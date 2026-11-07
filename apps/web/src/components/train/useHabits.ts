// What the habit screens share: today's practice rows, the top dream sign (the same shortlist as Signs and Home) and the
// reality-check target (the reminders' "how many a day"). Worked out on the device from the lists already loaded.
import { computed } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { elementStats, signShortlist, rcSchedule } from "@somnium/shared";
import { useJournal } from "../../api/journal";
import { useHabitLog, useTrain } from "../../api/train";
import { signLexicons, loadSignLexicons } from "../../api/signs";
import { REMINDERS_KEY, fetchReminders, rcRow } from "../../native/reminders";
import { useToday } from "../../core/today";
import { localYmd } from "../../core/format";

export function useHabits() {
  const j = useJournal(), t = useTrain(), log = useHabitLog(), today = useToday();
  void loadSignLexicons();
  const reminders = useQuery({ queryKey: [...REMINDERS_KEY], queryFn: fetchReminders, staleTime: 60_000 });
  const rows = computed(() => log.data.value ?? []);
  const rowOf = (item: string) => rows.value.find((r) => r.date === today.value && r.item === item && r.done);
  const topSign = computed(() => {
    const els = j.elements.data.value ?? [], facts = j.facts.data.value ?? [];
    const top = signShortlist(els, elementStats(els, j.links.data.value ?? [], facts, today.value), facts, signLexicons.value?.checks ?? [], today.value, 1)[0];
    return top ? { id: top.element.id, name: top.element.name ?? "" } : null;
  });
  const checkTarget = computed(() => rcSchedule(rcRow(reminders.data.value ?? [])?.schedule).perDay);
  const checksToday = computed(() => (t.checks.data.value ?? []).filter((c) => localYmd(new Date(c.at)) === today.value).length);
  const wroteToday = computed(() => (j.nights.data.value ?? []).some((n) => n.date === today.value && (n.dreamCount > 0 || n.noRecall)));
  return { j, t, log, today, rows, rowOf, topSign, checkTarget, checksToday, wroteToday, ready: computed(() => !!log.data.value && !!j.nights.data.value && !!t.checks.data.value && !!reminders.data.value) };
}
