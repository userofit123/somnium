// Somnium's service worker: makes the web app installable and lets it open without a connection.
// Pages: the network first, the last copy when offline. Built files (hashed names, never change): from the cache.
// Your data is not cached here (the app keeps its own copy of it, api/replica.ts); photos are, once seen, so they show
// offline too. They are as the server holds them, sealed, and signing out deletes them (forgetCachedMedia in
// api/media.ts). A fetch still on its way at that moment can add one back, sealed like the rest. In development nothing else is cached.
const CACHE = "somnium-v3";
const DEV = (p) => p.startsWith("/@") || p.startsWith("/src/") || p.startsWith("/node_modules/") || p.includes("?t=") || p.includes("?v=");

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

// tapping a notification (a reminder) opens the app on the page it names; a button on it (Snooze, say) is passed to the
// open app instead, which then shows the notification again as it now is. With no window open, the app is opened with
// the button in its address, and does it once started.
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = e.notification.data?.url ?? "/";
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const c = all.find((x) => new URL(x.url).origin === location.origin);
    if (e.action && c) { c.postMessage({ somniumAction: e.action }); return; }
    if (c) { await c.focus(); c.navigate?.(url).catch?.(() => {}); return; }
    const open = new URL(url, location.origin);
    if (e.action) open.searchParams.set("somniumAction", e.action);
    await self.clients.openWindow(open.pathname + open.search);
  })());
});

self.addEventListener("fetch", (e) => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== "GET" || u.origin !== location.origin || DEV(u.pathname + u.search)) return;
  const photo = u.pathname.startsWith("/api/media/");
  if (u.pathname.startsWith("/api/") && !photo) return;
  if (r.mode === "navigate") { e.respondWith(page(e)); return; }
  if (keep(u.pathname)) {
    e.respondWith(caches.match(r).then((m) => m ?? fetch(r).then((res) => {
      if (keepable(res)) { const c = res.clone(); caches.open(CACHE).then((cc) => cc.put(r, c)); }
      return res;
    })));
  }
});

// The server answers any path it doesn't have with the app's page (200, HTML), a built file of an older version
// included: that is never kept under the file's name, where it would stand in for the file for good.
const keepable = (res) => res.ok && !/text\/html/.test(res.headers.get("content-type") ?? "");
const keep = (p) => p.startsWith("/api/media/") || p.startsWith("/assets/") || p.startsWith("/fonts/") || /\.(png|svg|woff2?)$/.test(p);
const PAGE_WAIT = 4000;

// The page: the network when it answers, the last copy otherwise. A switched-off server behind Tailscale or on the
// LAN often doesn't refuse, it just never answers, so the request would hang for minutes: after a few seconds the
// last copy opens (the network's answer still refreshes it when it comes). An error page from the proxy (the server
// is down, 502) is never kept or shown over the copy.
async function page(e) {
  const copy = await caches.match("/");
  let saving = Promise.resolve();
  const net = fetch(e.request).then((res) => {
    if (res.ok) { saving = keepPage(res.clone()); return res; }
    if (copy) throw new Error(String(res.status));
    return res; // never opened here before: whatever the network says
  });
  // the worker stays up until the late answer has refreshed the copy, even when the copy was shown first
  e.waitUntil(net.then(() => saving).catch(() => {}));
  if (!copy) return net;
  return Promise.race([net, new Promise((ok) => setTimeout(() => ok(copy), PAGE_WAIT))]).catch(() => copy);
}

// The development server's page loads its code straight from the sources (/@vite/client): never kept, like
// everything else in development.
async function keepPage(res) {
  const html = await res.clone().text();
  if (html.includes("/@vite/client")) return;
  await (await caches.open(CACHE)).put("/", res);
}

// The page lists the files it loaded (some before this worker was looking after it, on the very first visit), so
// the app opens offline from the first time on rather than from the second.
self.addEventListener("message", (e) => {
  if (!Array.isArray(e.data?.keep)) return;
  e.waitUntil((async () => {
    const cc = await caches.open(CACHE);
    for (const p of e.data.keep) {
      if (typeof p !== "string") continue;
      // only this app's own files: a list naming another site is ignored
      let u;
      try { u = new URL(p, location.origin); } catch { continue; }
      if (u.origin !== location.origin || DEV(u.pathname + u.search)) continue;
      const isPage = u.pathname === "/" && !u.search;
      if ((!isPage && !keep(u.pathname)) || (await cc.match(u.href))) continue;
      try {
        const res = await fetch(u.href, { method: "GET" });
        if (isPage ? res.ok : keepable(res)) await (isPage ? keepPage(res) : cc.put(u.href, res));
      } catch { /* next time */ }
    }
    await keepImported(cc);
  })());
});

// Code loaded only when it is needed (the dream analysis lexicons, the reality check screen's parts) is not on the
// page's list until something has used it, and offline it then fails to load ("Failed to fetch dynamically imported
// module"). So every kept built file is read for the files it can import ("./name-hash.js", "assets/name-hash.css"),
// and those are kept too, and theirs in turn. Built names never change, so each is fetched once.
const IMPORTED = /(?:\.\/|\/?assets\/)([\w.-]+\.(?:js|css|wasm|data))\b/g;
async function keepImported(cc) {
  const seen = new Set(), todo = [];
  for (const r of await cc.keys()) { const p = new URL(r.url).pathname; if (p.startsWith("/assets/") && p.endsWith(".js")) todo.push(p); }
  while (todo.length) {
    const p = todo.pop();
    if (seen.has(p)) continue;
    seen.add(p);
    let res = await cc.match(p);
    if (!res) {
      try { res = await fetch(p); } catch { continue; } // next time
      if (!keepable(res)) continue;
      await cc.put(p, res.clone());
    }
    if (!p.endsWith(".js")) continue;
    for (const m of (await res.text()).matchAll(IMPORTED)) { const next = "/assets/" + m[1]; if (!seen.has(next)) todo.push(next); }
  }
}
