// When the first-run setup (LDJ-77) shows: once, after the first sign-in or a new local account, before the shells, and
// only behind an open lock (App.vue mounts it in the unlocked branch, so nothing of it renders over the lock screen).
// An account that already holds dreams (made before the setup existed, or a second device) never gets it unasked;
// Settings → Sleep can run it again.
import { computed, ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { api } from "../../api/client";
import type { SettingsMe } from "../../api/queries";
import { session } from "../../core/session";
import { lock } from "../../core/lock";
import { withDefaults } from "@somnium/shared";

/** Run again from Settings, or under way: kept here so a lock in the middle of it comes back to the same step. */
export const setupRun = ref(false);
export const setupStep = ref(0);

/** One step on its own (the safety check from Settings or the WBTB planner): the screen closes after it, back to where
 *  the person was, instead of going on through the rest of the setup. */
export const setupOnly = ref<string | null>(null);

export function startSetup() { setupOnly.value = null; setupStep.value = 0; setupRun.value = true; }
/** The safety check alone (LDJ-116). SetupScreen finds its step by id. */
export function startSafetyCheck() { setupOnly.value = "safety"; setupRun.value = true; }

export function useSetupGate() {
  // the same query as useMe, asked only once someone is signed in and the lock is open
  const me = useQuery({ queryKey: ["settings", "me"], queryFn: () => api.get<SettingsMe>("/me"), staleTime: 60_000, enabled: computed(() => !!session.user && !lock.locked) });
  const done = computed(() => withDefaults(me.data.value?.settings ?? {}).setup.done);
  // only asked while the setup is not done; filed under "journal" so a dream written elsewhere closes the question
  const any = useQuery({
    queryKey: ["journal", "setup-any"],
    queryFn: () => api.get<unknown[]>("/dreams", { limit: 1 }),
    enabled: computed(() => me.isSuccess.value && !done.value),
  });
  /** Waiting to know: the splash stays, so Home doesn't flash before the setup. An error never holds the app. */
  const pending = computed(() => !setupRun.value && (me.isPending.value || (me.isSuccess.value && !done.value && any.isPending.value)));
  const show = computed(() => setupRun.value || (me.isSuccess.value && !done.value && any.isSuccess.value && !any.data.value?.length));
  return { pending, show };
}
