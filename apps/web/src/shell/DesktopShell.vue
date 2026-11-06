<script setup lang="ts">
// The computer layout: Money Manager's rail with its gliding highlight, and the page.
import { ref, watch, nextTick, onMounted, onBeforeUnmount, computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { NAV, section } from "./nav";
import { appearanceOpen } from "../core/ui";
import { session, signOut } from "../core/session";
import { useMe } from "../api/queries";
import Icon from "../components/Icon.vue";
import Logo from "./Logo.vue";
import SyncPill from "./SyncPill.vue";
import UpdateButton from "./UpdateButton.vue";
import Menu from "../components/Menu.vue";
import { useAutoUpdate } from "../core/updater";
// the apps check for (and, if chosen, download) updates on their own while someone is signed in
useAutoUpdate();

const route = useRoute(), router = useRouter();
const cur = computed(() => section(route.name as string));
const me = useMe();
const nav = ref<HTMLElement | null>(null), pill = ref<HTMLElement | null>(null);

// the highlight glides from the previous page to the open one, stretching on the way (Money Manager's AppNav)
let at: { x: number; y: number; w: number; h: number } | null = null, anim: Animation | null = null;
function place(animate: boolean) {
  const nv = nav.value, p = pill.value; if (!nv || !p) return;
  const b = nv.querySelector<HTMLElement>(".nb.on"), ic = b?.querySelector<HTMLElement>(".ic");
  if (!b || !ic) { p.style.display = "none"; nv.classList.remove("pl"); at = null; return; }
  const to = { x: b.offsetLeft + ic.offsetLeft, y: b.offsetTop + ic.offsetTop, w: ic.offsetWidth, h: ic.offsetHeight };
  p.style.display = ""; p.style.width = to.w + "px"; p.style.height = to.h + "px"; p.style.borderRadius = getComputedStyle(ic).borderTopLeftRadius; nv.classList.add("pl");
  const set = (r: typeof to) => `translate(${r.x}px,${r.y}px) scale(${r.w / to.w},${r.h / to.h})`;
  const from = at; at = to; anim?.cancel();
  p.style.transform = set(to);
  if (!animate || !from || from.y === to.y || matchMedia("(prefers-reduced-motion:reduce)").matches) return;
  const fwd = to.y > from.y, top = Math.min(from.y, to.y), bot = Math.max(from.y + from.h, to.y + to.h);
  const mid = { x: to.x + to.w * 0.2, y: top, w: to.w * 0.6, h: bot - top };
  anim = p.animate([{ transform: set(from) }, { transform: set(mid), offset: 0.5 }, { transform: set(to) }], { duration: 320, easing: fwd ? "cubic-bezier(.4,0,.2,1)" : "cubic-bezier(.4,0,.2,1)" });
}
watch(cur, () => nextTick(() => place(true)));
const onResize = () => place(false);
let mo: MutationObserver | null = null;
onMounted(() => {
  nextTick(() => place(false)); setTimeout(onResize, 80); addEventListener("resize", onResize);
  mo = new MutationObserver(onResize); mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-rad", "data-nav", "data-nsp", "data-fnt"] });
  document.fonts?.ready.then(onResize);
});
onBeforeUnmount(() => { removeEventListener("resize", onResize); mo?.disconnect(); });
const acctMenu = computed(() => [
  { label: me.data.value?.user.displayName || session.user?.username || "Account", icon: "user", run: () => router.push("/settings/account") },
  { label: "Sign out", icon: "logout", run: async () => { await signOut(); } },
]);
// one key per page, so moving between pages animates; settings sections animate inside the page instead
const pageKey = (r: any) => (r.name === "settings" ? "settings" : r.path);
// once a page has moved in, anything that appears on it later rises in by itself (see app.css)
const arrived = (el: Element) => el.classList?.add("in");
</script>

<template>
  <div class="shell">
    <nav ref="nav" aria-label="Menu">
      <i ref="pill" class="nbi" style="transform-origin:0 0" />
      <Logo shuffle />
      <button v-for="p in NAV" :key="p.name" type="button" class="nb" :class="{ on: cur === p.name }" :aria-current="cur === p.name ? 'page' : undefined" @click="router.push(p.to)">
        <span class="ic"><Icon :name="p.icon" :size="22" /></span>{{ p.label }}
      </button>
      <div class="navb">
        <UpdateButton />
        <Menu :items="acctMenu" icon="user" label="Account" />
        <button id="themeBtn" type="button" class="nb" @click.stop="appearanceOpen = !appearanceOpen"><span class="ic"><Icon name="palette" :size="22" /></span>Appearance</button>
      </div>
    </nav>
    <main><router-view v-slot="{ Component, route: r }"><Suspense><Transition name="page" mode="out-in" appear @after-enter="arrived"><component :is="Component" :key="pageKey(r)" /></Transition></Suspense></router-view></main>
    <SyncPill />
  </div>
</template>
