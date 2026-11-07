// Keeps keyboard focus inside a sheet or a full-screen dialog while it is open, and puts it back where it was when
// it closes (WCAG 2.4.3). Dialogs can stack (a preview over a picker): only the one opened last holds Tab.
const SEL = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"]),[contenteditable="true"]';
const stack: HTMLElement[] = [];
const stops = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>(SEL)].filter((e) => !e.closest("[inert],[aria-hidden=true]") && e.getClientRects().length > 0);

function key(e: KeyboardEvent) {
  const el = stack.at(-1);
  if (e.key !== "Tab" || !el) return;
  const s = stops(el);
  if (!s.length) { e.preventDefault(); el.focus(); return; }
  const first = s[0]!, last = s.at(-1)!, a = document.activeElement;
  if (!el.contains(a)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
  else if (e.shiftKey && a === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); }
}

/** Holds focus in `el` until the returned function is called. Focus moves in unless something inside already has it
 *  (an autofocus field); the container itself takes it then, so a screen reader reads the dialog's name first. */
export function trapFocus(el: HTMLElement): () => void {
  const back = document.activeElement as HTMLElement | null;
  if (!stack.length) document.addEventListener("keydown", key);
  stack.push(el);
  if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
  requestAnimationFrame(() => { if (!el.contains(document.activeElement)) el.focus({ preventScroll: true }); });
  return () => {
    const i = stack.indexOf(el);
    if (i >= 0) stack.splice(i, 1);
    if (!stack.length) document.removeEventListener("keydown", key);
    if (back?.isConnected && (el.contains(document.activeElement) || document.activeElement === document.body)) back.focus({ preventScroll: true });
  };
}

/** The same as a directive, for a dialog that is shown with v-if: `<div v-if="open" v-trap role="dialog">` */
type Held = HTMLElement & { _release?: () => void };
export const vTrap = {
  mounted: (el: Held) => { el._release = trapFocus(el); },
  beforeUnmount: (el: Held) => { el._release?.(); delete el._release; },
};
