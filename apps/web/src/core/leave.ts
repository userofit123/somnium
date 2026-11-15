// Leaving a page with unsaved changes, by its own Back, the phone's Back or the browser's: ask first (PLAN.md §10.0).
import { onBeforeUnmount } from "vue";
import { onBeforeRouteLeave, onBeforeRouteUpdate, type Router, type RouteLocationNormalized } from "vue-router";
import { confirm } from "./ask";
import { sheetIsOpen, backPressed } from "./sheets";
import { NAV, section } from "../shell/nav";

export function useLeaveGuard(dirty: () => boolean, o: { title?: string; text?: string; onDiscard?: () => void } = {}) {
  const ask = async (to: RouteLocationNormalized, from: RouteLocationNormalized) => {
    // a sheet closing takes back its own history step, which the router sees as a visit to this same page
    if (!dirty() || to.fullPath === from.fullPath) return true;
    // Back with a sheet open only closes the sheet (core/sheets.ts cancels the move), so there's nothing to ask
    if (backPressed() && sheetIsOpen()) return true;
    const ok = await confirm(o.title ?? "Discard your changes?", { text: o.text, ok: "Discard", danger: true, noHistory: true });
    if (ok) o.onDiscard?.();
    return ok;
  };
  onBeforeRouteLeave(ask);
  onBeforeRouteUpdate(ask);
  // closing or reloading the tab: the browser asks with its own words
  const unload = (e: BeforeUnloadEvent) => { if (dirty()) e.preventDefault(); };
  addEventListener("beforeunload", unload);
  onBeforeUnmount(() => removeEventListener("beforeunload", unload));
}

/** A page's own Back: one step back, or to `fallback` when the page was opened directly (nothing to go back to). */
export function goBack(router: Router, fallback: string) {
  if (history.state?.back) router.back(); else router.replace(fallback);
}

/** What a page's own Back says: the page it returns to (Learn, Home, Train...), or `fallback` (the page `goBack`'s
 *  fallback leads to) when it was opened directly. Read once when the page opens: history.state isn't reactive. */
export function backLabel(router: Router, fallback: string): string {
  const back = history.state?.back;
  if (typeof back !== "string") return fallback;
  const s = section(router.resolve(back).name as string | undefined);
  return NAV.find((n) => n.name === s)?.label ?? (s === "more" ? "More" : "Back");
}

/** Whether the page was opened from a page under `prefix` (Learn's article from its own section list, say). False when
 *  opened directly too, so callers that need "came from elsewhere" also check `history.state.back` is a string. */
export function openedFrom(prefix: string): boolean {
  const back = history.state?.back;
  return typeof back === "string" && (back === prefix || back.startsWith(prefix + "/"));
}
