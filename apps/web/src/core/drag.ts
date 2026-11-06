// Reordering a list by dragging a handle, with a mouse or a finger. The item lifts and follows the pointer, the others
// slide to make room, and a dashed slot shows where it will land. Positions are kept relative to the list, so the page
// can scroll (it does near the screen edges) while dragging.
import { nextTick } from "vue";

interface Opts {
  list: HTMLElement; // holds the items as direct children marked data-drag
  index: number; // the item being dragged
  before?: () => void; // e.g. collapse every card first; measured after the screen updates
  move: (from: number, to: number) => void;
}

const scroller = (el: HTMLElement | null): HTMLElement => {
  for (let p = el?.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === "auto" || o === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return document.scrollingElement as HTMLElement;
};

export async function startDrag(e: PointerEvent, o: Opts) {
  if (e.button !== 0) return;
  e.preventDefault();
  const handle = e.currentTarget as HTMLElement;
  const items0 = () => [...o.list.children].filter((c) => (c as HTMLElement).dataset.drag != null) as HTMLElement[];
  const grab0 = e.clientY - items0()[o.index]!.getBoundingClientRect().top;
  let y = e.clientY;
  // keep listening from the very start: the finger may move while the list re-renders
  let ready = false, released = false;
  const onMove = (ev: PointerEvent) => { y = ev.clientY; ev.preventDefault(); };
  const onUp = () => { released = true; if (ready) end(); };
  addEventListener("pointermove", onMove, { passive: false });
  addEventListener("pointerup", onUp);
  addEventListener("pointercancel", onUp);
  try { handle.setPointerCapture(e.pointerId); } catch { /* the handle may be re-rendered */ }

  o.before?.();
  await nextTick();
  const items = items0(), el = items[o.index]!;
  const base = () => o.list.getBoundingClientRect().top;
  const top0 = base();
  const rects = items.map((x) => { const r = x.getBoundingClientRect(); return { top: r.top - top0, bottom: r.bottom - top0 }; });
  const h = rects[o.index]!.bottom - rects[o.index]!.top;
  const gap = rects.length > 1 ? Math.max(0, rects[1]!.top - rects[0]!.bottom) : 0;
  const grab = Math.min(grab0, h - 8);
  const sc = scroller(o.list);

  const slot = document.createElement("div");
  slot.className = "drag-slot";
  slot.style.height = `${h}px`;
  o.list.classList.add("dragging");
  o.list.appendChild(slot);
  el.classList.add("lifted");
  items.forEach((x) => { if (x !== el) x.style.transition = "transform .18s"; });

  let to = o.index, raf = 0, done = false;
  const frame = () => {
    if (done) return;
    // scroll when the finger is near the top or bottom of the screen
    const edge = 70, sr = sc === document.scrollingElement ? { top: 0, bottom: innerHeight } : sc.getBoundingClientRect();
    if (y < sr.top + edge) sc.scrollTop -= Math.ceil((sr.top + edge - y) / 6);
    else if (y > sr.bottom - edge) sc.scrollTop += Math.ceil((y - sr.bottom + edge) / 6);

    const rel = y - base(), at = rel - grab;
    el.style.transform = `translateY(${at - rects[o.index]!.top}px)`;
    const centre = at + h / 2;
    to = 0;
    rects.forEach((r, i) => { if (i !== o.index && (r.top + r.bottom) / 2 < centre) to++; });
    items.forEach((x, i) => {
      if (x === el) return;
      const d = o.index < to && i > o.index && i <= to ? -(h + gap) : to < o.index && i >= to && i < o.index ? h + gap : 0;
      x.style.transform = d ? `translateY(${d}px)` : "";
    });
    const land = to > o.index ? rects[to]!.bottom - h : rects[to]!.top;
    slot.style.transform = `translateY(${land}px)`;
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  const end = () => {
    done = true;
    cancelAnimationFrame(raf);
    removeEventListener("pointermove", onMove);
    removeEventListener("pointerup", onUp);
    removeEventListener("pointercancel", onUp);
    // put everything back without animating, then reorder: the items render in their new places in the same frame
    items.forEach((x) => { x.style.transition = "none"; x.style.transform = ""; });
    el.classList.remove("lifted");
    slot.remove();
    o.list.classList.remove("dragging");
    if (to !== o.index) o.move(o.index, to);
    nextTick(() => requestAnimationFrame(() => items.forEach((x) => { x.style.transition = ""; })));
  };
  ready = true;
  if (released) end();
}
