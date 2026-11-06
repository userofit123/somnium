// One shared lock that stops the page scrolling behind a modal overlay (sheets, ask dialogs, the command palette).
// Counted, so two sheets open at once keep the page still until the last one closes. The page scrolls on the document
// itself (the rail is sticky, there is no scrolling main element), so the lock goes on <html>: that keeps the scroll
// position as it is, and padding the width of the vanished scrollbar stops the page shifting sideways on a computer.
let count = 0;
export function lockScroll() {
  if (count++ === 0) {
    const h = document.documentElement, bar = innerWidth - h.clientWidth;
    if (bar > 0) h.style.paddingInlineEnd = bar + "px";
    h.style.overflow = "hidden";
  }
  let held = true;
  return () => { // release is safe to call twice
    if (!held) return;
    held = false;
    if (--count === 0) { const h = document.documentElement; h.style.overflow = ""; h.style.paddingInlineEnd = ""; }
  };
}
