// A page's own Back: where it goes and what it says.
import type { Router } from "vue-router";
import { NAV, section } from "../shell/nav";

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
