// Pull a phone bottom sheet down to close it (used by Sheet.vue and the Appearance panel). Decided on the first few
// pixels; a pull only starts when whatever is under the finger is scrolled to the top. `scrim` is the dimmed layer
// behind the sheet, faded as it moves. `close` runs once the sheet has slid away. `pulledAway` is true after a pull
// closed it, so the caller can skip its own closing animation.
import { onMounted, onBeforeUnmount } from "vue";
import { isPhone } from "./device";

export function usePullDown(sheet: () => HTMLElement | null, scrim: () => HTMLElement | null, enabled: () => boolean, close: () => void) {
  const state = { pulledAway: false };
  let x0 = 0, y0 = 0, t0 = 0, dy = 0, mode: "" | "pull" | "no" = "", scroller: HTMLElement | null = null;
  function scrollParent(t: EventTarget | null) {
    for (let el = t as HTMLElement | null; el && el !== sheet(); el = el.parentElement) {
      const o = getComputedStyle(el).overflowY;
      if ((o === "auto" || o === "scroll") && el.scrollHeight > el.clientHeight) return el;
    }
    return null;
  }
  function tstart(e: TouchEvent) {
    if (!isPhone.value || !enabled()) { mode = "no"; return; }
    const t = e.touches[0]!;
    x0 = t.clientX; y0 = t.clientY; t0 = Date.now(); dy = 0;
    mode = e.touches.length > 1 || (e.target as HTMLElement).closest("input[type=range], textarea, [data-nopull]") ? "no" : "";
    scroller = scrollParent(e.target);
  }
  function tmove(e: TouchEvent) {
    if (mode === "no") return;
    const s = sheet()!, t = e.touches[0]!, dx = t.clientX - x0, d = t.clientY - y0;
    if (!mode) {
      if (Math.abs(d) < 8 && Math.abs(dx) < 8) return;
      if (d <= 0 || Math.abs(dx) > Math.abs(d) || (scroller && scroller.scrollTop > 0)) { mode = "no"; return; }
      mode = "pull"; y0 = t.clientY;
      s.style.transition = "none";
    }
    e.preventDefault();
    dy = Math.max(0, t.clientY - y0);
    s.style.transform = `translateY(${dy}px)`;
    const b = scrim();
    if (b) b.style.backgroundColor = `color-mix(in srgb, var(--scrim) ${Math.max(0, 100 - (dy / s.offsetHeight) * 100)}%, transparent)`;
  }
  function tend() {
    if (mode !== "pull") { mode = ""; return; }
    mode = "";
    const s = sheet()!, b = scrim(), fast = dy > 40 && dy / Math.max(1, Date.now() - t0) > 0.6;
    s.style.transition = "transform .22s var(--ease)";
    if (b) b.style.transition = "background-color .22s";
    if (dy > Math.min(140, s.offsetHeight / 3) || fast) {
      state.pulledAway = true;
      s.style.transform = "translateY(100%)";
      if (b) b.style.backgroundColor = "transparent";
      setTimeout(() => {
        close();
        // after the caller has had a tick to unmount or hide it, so the sheet is ready for next time
        setTimeout(() => { s.style.transform = ""; s.style.transition = ""; state.pulledAway = false; }, 50);
      }, 200);
    } else {
      s.style.transform = "";
      if (b) b.style.backgroundColor = "";
    }
  }
  onMounted(() => {
    const s = sheet()!;
    s.addEventListener("touchstart", tstart, { passive: true });
    s.addEventListener("touchmove", tmove, { passive: false });
    s.addEventListener("touchend", tend);
    s.addEventListener("touchcancel", tend);
  });
  return state;
}
