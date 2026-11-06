// Today's local date as a ref that turns over at midnight, for screens left open across it (the Journal, Train).
// One timer for the whole app, armed for the next local midnight; waking the page re-checks, since a sleeping
// device can miss the timer.
import { readonly, ref, type Ref } from "vue";
import { localYmd } from "./format";

const today = ref(localYmd(new Date()));
let timer: ReturnType<typeof setTimeout> | undefined;

function tick() {
  const now = new Date();
  today.value = localYmd(now);
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
  clearTimeout(timer);
  timer = setTimeout(tick, next.getTime() - now.getTime());
}

let armed = false;
/** The local date (YYYY-MM-DD), kept current. */
export function useToday(): Readonly<Ref<string>> {
  if (!armed) {
    armed = true;
    tick();
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") tick(); });
  }
  return readonly(today);
}
