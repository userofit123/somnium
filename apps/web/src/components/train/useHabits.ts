// What the habit screens share: today's practice rows, the top dream sign (the same shortlist as Signs and Home) and
// today's reality checks against their target. Worked out on the device from the lists already loaded.
import { computed } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { topSigns, weekTarget, rcSchedule, planDay, checksOn } from "@somnium/shared";
import { useJournal } from "../../api/journal";
import { useHabitLog, useTrain } from "../../api/train";
import { signLexicons, loadSignLexicons } from "../../api/signs";
import { REMINDERS_KEY, fetchReminders, rcRow } from "../../native/reminders";
import { useToday } from "../../core/today";
import { useSettings } from "../../api/queries";
import { localYmd } from "../../core/format";

export function useHabits() {
  const j = useJournal(), t = useTrain(), log = useHabitLog(), today = useToday();
  void loadSignLexicons();
  const reminders = useQuery({ queryKey: [...REMINDERS_KEY], queryFn: fetchReminders, staleTime: 60_000 });
  const rows = computed(() => log.data.value ?? []);
  const rowAt = (item: string, date: string) => rows.value.find((r) => r.date === date && r.item === item && r.done);
  const rowOf = (item: string) => rowAt(item, today.value);
  const topSign = computed(() => {
    const els = j.elements.data.value ?? [], facts = j.facts.data.value ?? [];
    const top = topSigns(els, j.links.data.value ?? [], facts, signLexicons.value?.checks ?? [], today.value, 1, { target: weekTarget(settings.value) })[0];
    // with the reality check paired with it (the evening review offers it)
    return top ? { id: top.element.id, name: top.element.name ?? "", check: top.check ? { id: top.check.id, name: top.check.name } : null } : null;
  });
  const settings = useSettings();
  const rc = computed(() => rcRow(reminders.data.value ?? []));
  const remindersOn = computed(() => !!rc.value?.enabled);
  // while reminders are on: today's planned times (and yesterday's and tomorrow's, for the next one across midnight)
  const plan = computed(() => {
    if (!rc.value?.enabled) return { today: 0, times: [] as number[] };
    const s = rcSchedule(rc.value.schedule), sleep = settings.value.sleep;
    const days = [-1, 0, 1].map((d) => { const x = new Date(today.value + "T12:00:00"); x.setDate(x.getDate() + d); return localYmd(x); });
    return { today: planDay(s, today.value, s.seed, sleep).length, times: days.flatMap((d) => planDay(s, d, s.seed, sleep).map((p) => p.at)) };
  });
  // one target everywhere: the reminders planned for today while they are on, else the "how many a day" setting.
  // At least one, so a paused day doesn't tick the habit with no check done.
  const checkTarget = computed(() => Math.max(1, remindersOn.value ? plan.value.today : rcSchedule(rc.value?.schedule).perDay));
  const checksToday = computed(() => checksOn((t.checks.data.value ?? []).map((c) => localYmd(new Date(c.at))), today.value));
  const wroteToday = computed(() => (j.nights.data.value ?? []).some((n) => n.date === today.value && (n.dreamCount > 0 || n.noRecall)));
  return { j, t, log, today, rows, rowAt, rowOf, topSign, remindersOn, plan, checkTarget, checksToday, wroteToday, ready: computed(() => !!log.data.value && !!j.nights.data.value && !!t.checks.data.value && !!reminders.data.value) };
}
