// Every screen's data, filed under a topic (the first part of the key) so live updates know what to reload.
import { computed, type Ref, unref, watch, type MaybeRef } from "vue";
import { useQuery, useMutation, useInfiniteQuery } from "@tanstack/vue-query";
import { withDefaults, type Settings, type Me } from "@somnium/shared";
import { api, httpTransport } from "./client";
import { sync } from "./replica";
import { invalidate, queryClient } from "./live";
import { toastError, savedToast, savedError } from "../core/toast";

/** What ["settings", "me"] holds: who is signed in and their settings. */
export type SettingsMe = { user: Me; settings: Settings };
export const useMe = () => useQuery({ queryKey: ["settings", "me"], queryFn: () => api.get<SettingsMe>("/me"), staleTime: 60_000 });
export function useSettings(): Ref<Settings> {
  const me = useMe();
  return computed(() => withDefaults(me.data.value?.settings ?? {}));
}
// The activity log, newest first, a page at a time. With an offline copy it comes from the server when it can be
// reached: the copy on this device only keeps the changes it hasn't sent yet. Any change can add to it, so it is
// fetched again whenever it is opened rather than filed under a topic.
export const useActivityLog = () => useInfiniteQuery({
  queryKey: ["log"], initialPageParam: "", staleTime: 0, refetchOnMount: "always",
  getNextPageParam: (p: { cursor: string | null }) => p.cursor ?? undefined,
  queryFn: async ({ pageParam }) => {
    const path = "/activity-log?" + new URLSearchParams({ limit: "40", ...(pageParam ? { before: pageParam } : {}) });
    if (sync.on) try { return await httpTransport.request("GET", path) as { entries: any[]; cursor: string | null }; } catch { /* offline: what this device has */ }
    return api.get<{ entries: any[]; cursor: string | null }>(path);
  },
});

/**
 * Holds a page back until its first data is in, so it fades in whole instead of piece by piece. `await loaded(a, b)` at the top of a page's setup; the shells wrap pages
 * in <Suspense>. A query that fails or isn't running (disabled, offline) doesn't hold it, and after a moment the
 * page shows anyway with its own loading states, so a slow server never leaves a blank screen.
 */
type Loadable = { status: Ref<string>; fetchStatus: Ref<string> };
export function loaded(...qs: Loadable[]): Promise<void> {
  const done = () => qs.every((q) => q.status.value !== "pending" || q.fetchStatus.value === "idle");
  if (done()) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => { clearTimeout(t); stop(); resolve(); };
    const t = setTimeout(finish, 1500);
    const stop = watch(done, (d) => { if (d) finish(); });
  });
}

/** A change: runs the call, refreshes what it touched on this device at once, and shows any error. */
export function useChange<A extends unknown[], R>(fn: (...a: A) => Promise<R>, topics: string[]) {
  const m = useMutation({ mutationFn: (a: A) => fn(...a), onSuccess: () => invalidate(topics), onError: toastError });
  return { run: (...a: A) => m.mutateAsync(a), busy: m.isPending };
}

/** Settings change, applied to the cache straight away so the screen does not wait for the server. */
// Saves go one after another: quick taps each build on the last one instead of racing and overwriting it.
let saving: Promise<unknown> = Promise.resolve();
// Refetch only once the last queued save is done: a refetch between two saves would bring back the older
// settings over the newer ones already shown, and a tap in that gap would build on the stale copy.
let pending = 0;
// quiet: for saves that aren't the person changing a setting (a dismissed suggestion) or that already say something
export function saveSettings(patch: Partial<Settings> | Record<string, unknown>, o: { quiet?: boolean } = {}) {
  // a settings fetch already under way would land after this change and undo it on screen
  void queryClient.cancelQueries({ queryKey: ["settings", "me"] });
  queryClient.setQueryData(["settings", "me"], (m: any) => m && { ...m, settings: mergePatch(m.settings, patch) });
  pending++;
  saving = saving.then(async () => {
    try { await api.put("/settings", patch); if (!o.quiet) savedToast(); } catch (e) { savedError(e); }
    if (--pending === 0) invalidate(["settings", "home"]);
  });
  return saving;
}
// the same merge the server does: objects merge, anything else (lists included) replaces
function mergePatch(a: any, b: any): any {
  if (Array.isArray(b) || b === null || typeof b !== "object") return b;
  const o = { ...(a && typeof a === "object" && !Array.isArray(a) ? a : {}) };
  for (const k of Object.keys(b)) o[k] = mergePatch(o[k], b[k]);
  return o;
}
