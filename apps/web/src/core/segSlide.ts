// @ts-nocheck -- ported as is from Money Manager (frontend/src/core/segSlide.js)
// The sliding highlight of every row of tabs (.seg): when another tab is picked, the coloured pill stretches and glides over to it.
// The pill is an <i class="segi"><b></b></i> put first in
// the .seg, styled in styles/components/tabs.css (.segi, .seg.sl). It watches the page, so every tab row gets it without any code in the page.
const st = new Map(), waiting = new Set();
let raf = 0, started = false;
const todo = new Set();
const RM = typeof matchMedia !== "undefined" ? matchMedia("(prefers-reduced-motion: reduce)") : { matches: true };

// which tab row this is, so its last place is remembered when the page draws it again
const KC = new WeakMap();
function keyOf(sg) {
  if (sg.id) return sg.id;
  let c = KC.get(sg); if (c) return c;
  const b = sg.querySelector("button"), k = b ? b.dataset.a || b.dataset.t || "x" : "x";
  let n = 0;
  for (const o of document.querySelectorAll(".seg")) { if (o == sg) break; const ob = o.querySelector("button"); if (ob && (ob.dataset.a || ob.dataset.t || "x") == k) n++; }
  c = k + "#" + n; KC.set(sg, c); return c;
}
const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const rad = (R, M, L, Rt) => { const a = L ? R : M, b = Rt ? R : M; return a + "px " + b + "px " + b + "px " + a + "px"; };
function put(p, g, l, r, rd, sy) {
  const e = p.firstChild;
  e.style.width = r - l + "px"; e.style.height = g.b - g.t + "px";
  e.style.transform = "translate(" + l + "px," + g.t + "px) scaleY(" + (sy || 1) + ")"; e.style.borderRadius = rd;
}

function sync(sg) {
  if (!sg.isConnected) return;
  const bs = [...sg.querySelectorAll(":scope>button")], b = sg.querySelector(":scope>button.on");
  let pill = sg.querySelector(":scope>.segi");
  if (!b) { if (pill) pill.style.display = "none"; return; }
  if (!sg.offsetWidth) { waiting.add(sg); return; }
  waiting.delete(sg);
  if (!pill) { pill = document.createElement("i"); pill.className = "segi"; pill.innerHTML = "<b></b>"; sg.prepend(pill); sg.classList.add("sl"); }
  pill.style.display = "";
  const k = keyOf(sg), idx = bs.indexOf(b), g = { l: b.offsetLeft, r: b.offsetLeft + b.offsetWidth, t: b.offsetTop, b: b.offsetTop + b.offsetHeight }, h = g.b - g.t;
  const R = Math.round(Math.max(1, Math.min(parseFloat(getComputedStyle(b).borderTopLeftRadius) || 99, h / 2))), M = Math.min(R, Math.max(3, Math.round(h * 0.3)));
  const lo = Math.min(...bs.map((x) => x.offsetLeft)), hi = Math.max(...bs.map((x) => x.offsetLeft + x.offsetWidth)), rd = bs.length < 2 ? R + "px" : rad(R, M, g.l <= lo + 1, g.r >= hi - 1);
  let s = st.get(k);
  const e = pill.firstChild;
  const rest = () => { if (s.anim) { s.anim.cancel(); s.anim = null; } put(pill, g, g.l, g.r, rd); s.cur = { l: g.l, r: g.r, rd }; s.g = g; };
  if (!s) { s = { idx, anim: null }; st.set(k, s); put(pill, g, g.l, g.r, rd); s.cur = { l: g.l, r: g.r, rd }; s.g = g; return; }
  if (s.snap) { s.snap = false; s.idx = idx; rest(); return; }
  if (s.idx === idx) { if (!s.anim) put(pill, g, g.l, g.r, rd); s.cur = s.anim ? s.cur : { l: g.l, r: g.r, rd }; return; }
  s.idx = idx;
  if (RM.matches || !s.cur) { rest(); return; }
  const from = { ...s.cur }; if (s.anim) { s.anim.cancel(); s.anim = null; }
  // ends together with the page fade-in (.35s)
  const dist = Math.abs(g.l - from.l), dur = Math.round(Math.min(350, 250 + dist * 0.1)), N = 24, sq = Math.min(0.14, 0.05 + dist / 3000), kf = [];
  const c0 = (from.l + from.r) / 2, c1 = (g.l + g.r) / 2, w0 = from.r - from.l, w1 = g.r - g.l, stretch = Math.min(dist * 0.2, 44);
  put(pill, g, from.l, from.r, from.rd);
  for (let i = 0; i <= N; i++) {
    const t = i / N, x = ease(t), sn = Math.sin(Math.PI * t), sy = 1 - sn * sq, c = c0 + (c1 - c0) * x, w = w0 + (w1 - w0) * x + stretch * sn;
    kf.push({ width: w + "px", transform: "translate(" + (c - w / 2) + "px," + g.t + "px) scaleY(" + sy + ")", borderRadius: t < 0.5 ? from.rd : rd, offset: t });
  }
  kf[0].borderRadius = from.rd; kf[N].borderRadius = rd;
  s.anim = e.animate(kf, { duration: dur, easing: "linear", fill: "both" });
  s.anim.onfinish = () => { if (!s.anim) return; s.anim.cancel(); s.anim = null; put(pill, g, g.l, g.r, rd); s.cur = { l: g.l, r: g.r, rd }; };
  s.cur = { l: g.l, r: g.r, rd }; s.g = g; put(pill, g, g.l, g.r, rd);
}
const flush = () => { raf = 0; const l = [...todo]; todo.clear(); l.forEach(sync); };
const q = (sg) => { if (sg) todo.add(sg); if (!raf) raf = requestAnimationFrame(flush); };
const all = () => { document.querySelectorAll(".seg").forEach((x) => todo.add(x)); if (!raf) raf = requestAnimationFrame(flush); };

export function startSegSlide() {
  if (started || typeof MutationObserver === "undefined") return; started = true;
  new MutationObserver((ms) => {
    for (const m of ms) {
      if (m.type == "attributes") {
        if (m.target.closest && m.target.closest(".segi")) continue;
        const p = m.target.parentElement; if (p && p.classList.contains("seg")) q(p);
        if (waiting.size) waiting.forEach(q);
      } else {
        if (m.target.classList && m.target.classList.contains("seg") && ![...m.addedNodes].every((n) => n.classList && n.classList.contains("segi"))) q(m.target);
        for (const n of m.addedNodes) {
          if (n.nodeType != 1 || (n.classList && n.classList.contains("segi"))) continue;
          if (n.matches && n.matches(".seg")) q(n); else if (n.querySelectorAll) n.querySelectorAll(".seg").forEach(q);
        }
      }
    }
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "hidden"] });
  addEventListener("resize", () => { st.forEach((s) => { s.snap = true; }); all(); });
  // the language (right to left) or the look (font, density...) changed without a reload: every pill moves to its tab's new place at once
  new MutationObserver(() => { st.forEach((s) => { s.snap = true; }); all(); }).observe(document.documentElement, { attributes: true, attributeFilter: ["lang", "data-fnt", "data-den", "data-spc", "data-rad", "data-nav"] });
  all();
}

// Somnium: the underline of the page tabs (.tabs) glides to the chosen tab the same way, with a CSS transition.
const tq = new Set();
let traf = 0;
function syncTabs(t) {
  if (!t.isConnected) return;
  const b = t.querySelector(":scope>button.on");
  let bar = t.querySelector(":scope>.tabi");
  if (!b || !t.offsetWidth) { if (bar) bar.style.opacity = "0"; return; }
  const first = !bar;
  if (!bar) { bar = document.createElement("i"); bar.className = "tabi"; t.append(bar); t.classList.add("tsl"); }
  if (first) bar.style.transition = "none";
  bar.style.opacity = "1";
  bar.style.width = b.offsetWidth + "px";
  bar.style.transform = "translateX(" + b.offsetLeft + "px)";
  if (first) requestAnimationFrame(() => { bar.style.transition = ""; });
}
const tflush = () => { traf = 0; const l = [...tq]; tq.clear(); l.forEach(syncTabs); };
const tqueue = (t) => { tq.add(t); if (!traf) traf = requestAnimationFrame(tflush); };
export function startTabSlide() {
  if (typeof MutationObserver === "undefined") return;
  new MutationObserver((ms) => {
    for (const m of ms) {
      const el = m.target;
      if (el.classList?.contains("tabi")) continue;
      if (m.type == "attributes") { const p = el.parentElement; if (p?.classList.contains("tabs")) tqueue(p); }
      else for (const n of m.addedNodes) { if (n.nodeType != 1 || n.classList?.contains("tabi")) continue; if (n.matches(".tabs")) tqueue(n); else n.querySelectorAll?.(".tabs").forEach(tqueue); if (el.classList?.contains("tabs")) tqueue(el); }
    }
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  addEventListener("resize", () => document.querySelectorAll(".tabs").forEach(tqueue));
  document.querySelectorAll(".tabs").forEach(tqueue);
}
