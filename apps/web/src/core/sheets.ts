// Back (the phone's button or gesture, the browser's) closes an open sheet instead of leaving the page. Sheets don't add
// steps to the browser history: a Back while one is open is caught by the router and undone, and the sheet closes.
// (They used to add a step each, which left stray steps behind whenever a sheet's button went to another page, so Back
// sometimes needed an extra press or seemed to skip.)
const stack: { id: number; close: () => void }[] = [];
let n = 0, popped = false;
export const sheetIsOpen = () => stack.length > 0;

export function sheetOpened(close: () => void) {
  const id = ++n;
  stack.push({ id, close });
  return id;
}
export function sheetClosed(id: number) {
  const i = stack.findIndex((e) => e.id === id);
  if (i >= 0) stack.splice(i, 1);
}
/** Close the sheet on top (the Android app's back button calls this directly) */
export function closeTopSheet() { stack.at(-1)?.close(); }
/** True while the router handles a Back (popstate), not a link or a button */
export const backPressed = () => popped;

// the router reacts to popstate first and runs its guards a moment later, so this flag is set by then
addEventListener("popstate", () => { popped = true; setTimeout(() => (popped = false), 0); });
export function watchRouter(r: { beforeEach: (f: () => boolean | void) => void }) {
  r.beforeEach(() => {
    if (popped && stack.length) { popped = false; closeTopSheet(); return false; }
  });
}
