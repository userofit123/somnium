<script setup lang="ts">
// The phone layout: the page, and the tabs Home, Journal, +, Train, Progress, More (PLAN.md §6.0).
import { computed, onBeforeUnmount, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { section, TRAIN_TABS } from "./nav";
import Icon from "../components/Icon.vue";
import SyncPill from "./SyncPill.vue";
import { sheetIsOpen } from "../core/sheets";
import { useAutoUpdate } from "../core/updater";
import { useNeedsRecoveryKey } from "../core/recoveryNudge";
// the apps check for (and, if chosen, download) updates on their own while someone is signed in
useAutoUpdate();

const route = useRoute(), router = useRouter();
const cur = computed(() => section(route.name as string));
// the centre + is an action, not a page (Motus's Start tab)
const TABS: { name: string; label?: string; icon?: string; to?: string }[] = [
  { name: "home", label: "Home", icon: "home", to: "/" },
  { name: "journal", label: "Journal", icon: "book", to: "/journal" },
  { name: "add" },
  { name: "train", label: "Train", icon: "target", to: "/train" },
  { name: "progress", label: "Progress", icon: "stats", to: "/progress" },
  { name: "more", label: "More", icon: "moreH", to: "/more" },
];
// the + starts the morning capture for now (LDJ-80: still, then key words, then the editor). LDJ-92 turns it into the
// quick-add sheet (Write a dream, No recall, Log a reality check, Plan tonight, Day note; PLAN.md §6.0) shared with
// the desktop's + button: open that sheet here instead, its "Write a dream" going to the capture (name "capture")
const add = () => router.push({ name: "capture" });
// the pages listed on the More tab
const IN_MORE = ["more", "signs", "learn", "settings"];
// Settings is under More here: the dot for a missing recovery key goes on More (LDJ-151)
const needsKey = useNeedsRecoveryKey();
const moreOn = computed(() => IN_MORE.includes(cur.value));
// one key per page (Train's three tabs share one, which switches them itself), so moving between pages animates; pages wait for their data inside <Suspense> (see loaded() in api/queries) and fade in whole
const pageKey = (r: any) => (TRAIN_TABS.includes(r.name) ? "train" : r.path);
// once a page has moved in, anything that appears on it later rises in by itself (see app.css)
const arrived = (el: Element) => el.classList?.add("in");

// moving between tabs slides sideways, towards the tab you chose; anything else rises in
// the + is not in it, so a swipe from Journal goes straight to Train
const ORDER = ["home", "journal", "train", "progress", "more"];
const tabOf = (name: unknown) => { const c = section(name as string); return ORDER.indexOf(IN_MORE.includes(c) ? "more" : c); };
const motion = ref("page");
const stop = router.beforeEach((to, from) => {
  const a = tabOf(from.name), b = tabOf(to.name);
  motion.value = a >= 0 && b >= 0 && a !== b ? (b > a ? "tnx" : "tpv") : "page";
});
onBeforeUnmount(stop);

// on a tab's own page, a sideways swipe anywhere (cards or empty space) goes to the next or previous tab
let x0 = 0, y0 = 0, t0 = 0, ok = false;
function ts(e: TouchEvent) {
  const t = e.touches[0]!;
  x0 = t.clientX; y0 = t.clientY; t0 = Date.now();
  ok = e.touches.length === 1 && (ORDER.includes(route.name as string) || TRAIN_TABS.includes(route.name as string)) && !sheetIsOpen()
    && !(e.target as HTMLElement).closest(".dock, input, textarea, select, .hscroll, .chips, .seg, .tabs, .cal, .chart, [data-noswipe]")
    && x0 > 24 && x0 < innerWidth - 24; // the screen edges belong to the phone's own back gesture
}
function te(e: TouchEvent) {
  if (!ok) return;
  const t = e.changedTouches[0]!, dx = t.clientX - x0, dy = t.clientY - y0;
  if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.3 || Date.now() - t0 > 900) return; // a natural thumb swipe drifts a little
  const next = ORDER[ORDER.indexOf(section(route.name as string)) + (dx < 0 ? 1 : -1)];
  const tab = TABS.find((x) => x.name === next);
  if (tab?.to) router.push(tab.to);
}
</script>

<template>
  <div class="pshell" @touchstart.passive="ts" @touchend.passive="te">
    <div class="pmain" role="main"><router-view v-slot="{ Component, route: r }"><Suspense><Transition :name="motion" mode="out-in" appear @after-enter="arrived"><component :is="Component" :key="pageKey(r)" /></Transition></Suspense></router-view></div>
    <div class="dock">
      <div class="tabbar">
        <template v-for="t in TABS" :key="t.name">
          <button v-if="t.name === 'add'" type="button" aria-label="Write a dream" @click="add"><span class="start"><Icon name="plus" /></span></button>
          <button v-else type="button" :class="{ on: t.name === 'more' ? moreOn : cur === t.name }" :aria-current="(t.name === 'more' ? moreOn : cur === t.name) ? 'page' : undefined" @click="router.push(t.to!)"><span class="ic"><Icon :name="t.icon!" :size="22" /><i v-if="t.name === 'more' && needsKey" class="ndot" role="img" aria-label="Make your recovery key" /></span>{{ t.label }}</button>
        </template>
      </div>
    </div>
    <SyncPill />
  </div>
</template>
