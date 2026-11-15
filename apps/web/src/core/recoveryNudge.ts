// LDJ-151: someone who skipped the recovery key is reminded until they make one. The sealed journal makes it the one
// setting that can cost a person everything (a forgotten password with no key is a lost journal, PLAN.md §4.4), so it
// must not depend on them finding Settings · Security. A dot marks Settings in the rail and tab bar and the Security
// row; Home shows a card that can be put away for a week. None of it says anything about the journal.
// The state is read from the same places Security reads it: the server's /auth/security for a server account, the
// account's record on this device for a local one. Making the key there refreshes both, so the dot goes at once.
import { computed, ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { api } from "../api/client";
import { isLocalAccount, session } from "./session";
import { localKeys } from "./localLock";
import { readJson, writeJson } from "./prefs";

/** The query key of a local account's record (recovery key made, ...): Security refreshes it after making one. */
export const LOCAL_KEYS_KEY = ["settings", "local-keys"] as const;

/** true while this account has no recovery key; false until that is known (nothing shows on a guess) */
export function useNeedsRecoveryKey() {
  const local = ref<boolean | null>(null);
  void isLocalAccount().then((v) => { local.value = v; });
  // the same key and endpoint as Security's checklist, so one fetch serves both
  const server = useQuery({ queryKey: ["settings", "security"], queryFn: () => api.get<{ recoveryMadeAt: string | null }>("/auth/security"), enabled: computed(() => local.value === false) });
  const device = useQuery({ queryKey: [...LOCAL_KEYS_KEY], queryFn: () => localKeys(), enabled: computed(() => local.value === true) });
  return computed(() => {
    if (local.value === false) return !!server.data.value && !server.data.value.recoveryMadeAt;
    if (local.value === true) return !!device.data.value && !device.data.value.recoveryMadeAt;
    return false;
  });
}

// "Later" on Home's card: a week, on this device, per account (another account here may well have its key)
const LATER = "somniumRecoveryNudge";
const WEEK = 7 * 86400000;
const laterTick = ref(0);
const who = () => session.user?.id ?? "local";
export function nudgeHidden(): boolean {
  void laterTick.value;
  const until = readJson<Record<string, number>>(LATER, {})[who()] ?? 0;
  return Date.now() < until;
}
export function hideNudgeForAWeek() {
  writeJson(LATER, { ...readJson<Record<string, number>>(LATER, {}), [who()]: Date.now() + WEEK });
  laterTick.value++;
}
