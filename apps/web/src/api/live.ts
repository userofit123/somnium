// Live updates (PLAN.md §5): the server announces which topics a change touched, and every cached screen filed under
// one of those topics reloads. The same happens on this device right after its own changes.
import { QueryClient } from "@tanstack/vue-query";
import { server } from "./client";

export const queryClient = new QueryClient({
  // "always": with the offline copy, reading works without a connection, so queries must not wait for one
  defaultOptions: { queries: { staleTime: 30_000, gcTime: 30 * 60_000, retry: 1, refetchOnWindowFocus: true, networkMode: "always" }, mutations: { networkMode: "always" } },
});

export function invalidate(topics: string[]) {
  if (topics.includes("*")) { queryClient.invalidateQueries(); return; }
  queryClient.invalidateQueries({ predicate: (q) => topics.includes(String(q.queryKey[0])) });
}

// a change on the server: reload the screens it touched (or, with an offline copy, fetch it into that copy)
let remote = (topics: string[]) => invalidate(topics);
export const setRemoteHandler = (fn: (topics: string[]) => void) => { remote = fn; };

let es: EventSource | null = null, retry = 1000, poll: ReturnType<typeof setInterval> | null = null;
export const liveState = { connected: false };
export function startLive() {
  stopLive();
  try {
    // the apps sign in with a token, which EventSource cannot send: they fall back to checking every 30 s
    if (server.value.token) { poll = setInterval(() => remote(["home", "settings"]), 30_000); return; }
    es = new EventSource(server.value.base + "/api/events", { withCredentials: true });
    es.addEventListener("hello", () => { liveState.connected = true; retry = 1000; });
    es.addEventListener("change", (e) => { try { remote(JSON.parse((e as MessageEvent).data).topics); } catch { /* ignore a bad message */ } });
    es.onerror = () => {
      liveState.connected = false;
      es?.close(); es = null;
      setTimeout(startLive, retry);
      retry = Math.min(retry * 2, 60_000);
    };
  } catch { /* no live updates; screens still refresh on focus */ }
}
export function stopLive() { es?.close(); es = null; if (poll) clearInterval(poll); poll = null; }
