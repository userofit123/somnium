import { createApp } from "vue";
import { VueQueryPlugin } from "@tanstack/vue-query";
import App from "./App.vue";
import { router } from "./router";
import { queryClient } from "./api/live";
import { startTheme } from "./core/theme";
import "./styles/index.css";
import { startSegSlide, startTabSlide } from "./core/segSlide";
import { watchRouter } from "./core/sheets";
import type { RouteRecordNormalized } from "vue-router";

// the one piece of the desktop app's window.somniumNative (apps/desktop/src/preload.ts) this file uses
interface DesktopBridge { onOpen?: (cb: (path: string) => void) => void }
const desktopBridge = (): DesktopBridge | undefined => (globalThis as { somniumNative?: DesktopBridge }).somniumNative;

// The browser lists only 250 loaded files by default, fewer than the app has; the list is handed to the service
// worker below, so make room before the pages' code starts loading.
performance.setResourceTimingBufferSize?.(2000);

startTheme();
watchRouter(router);
createApp(App).use(router).use(VueQueryPlugin, { queryClient }).mount("#app");
// the desktop app asks for a page when its update notification is clicked (Android does this in native/android.ts)
desktopBridge()?.onOpen?.((path) => { if (typeof path === "string" && path.startsWith("/")) void router.push(path); });
// every row of tabs gets its gliding highlight without any code in the pages
startSegSlide();
startTabSlide();

// The service worker makes the web app installable on a phone ("Add to Home screen") and able to open offline.
// The Android and desktop apps carry their own files, so they don't need it.
if ("serviceWorker" in navigator && !(globalThis as any).Capacitor?.isNativePlatform?.() && !(globalThis as any).somniumNative) {
  addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => { /* not installable here, nothing else changes */ }));
}

// Fetch every page's code once the app is up, so pages not opened yet still open without a connection
// (the service worker keeps them), then hand the worker the list of everything loaded: on the very first visit the
// files came before it was looking after the page, and without them the app wouldn't open offline.
addEventListener("load", () => setTimeout(async () => {
  const pages = router.getRoutes().map((r) => r.components?.default)
    .filter((c): c is Extract<NonNullable<RouteRecordNormalized["components"]>[string], () => Promise<unknown>> => typeof c === "function");
  await Promise.allSettled(pages.map((c) => c()));
  const sw = navigator.serviceWorker && (await Promise.race([navigator.serviceWorker.ready, new Promise<null>((ok) => setTimeout(() => ok(null), 10_000))]));
  const files = performance.getEntriesByType("resource").map((e) => new URL(e.name)).filter((u) => u.origin === location.origin).map((u) => u.pathname);
  sw?.active?.postMessage({ keep: ["/", ...new Set(files)] });
}, 3000));
