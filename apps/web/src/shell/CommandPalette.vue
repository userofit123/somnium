<script setup lang="ts">
// Ctrl+K (or ⌘K): start something or jump anywhere by typing (an optional feature; Motus's palette, LDJ-130). Actions
// first (the + sheet's), then the pages, techniques, Learn articles, Settings sections and dreams by title. The dreams
// are the journal's own list on this device, already opened: the palette only filters it here and sends nothing. It is
// mounted only with the journal open (Overlays.vue), and locking clears the query cache, so no title outlives the lock.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { lockScroll } from "../core/scrollLock";
import { useRouter } from "vue-router";
import { isPlanOnly, nightOfDate } from "@somnium/shared";
import { api } from "../api/client";
import { DREAM_LIMIT, markNoRecall, uuidv7, type DreamRow, type NightRow } from "../api/journal";
import { useToday } from "../core/today";
import { toast, toastError } from "../core/toast";
import { NAV } from "./nav";
import { SETTINGS_ENTRIES, knowledgeEntries, loadKnowledge } from "./paletteItems";
import Icon from "../components/Icon.vue";

const router = useRouter();
const today = useToday();
const open = ref(false), q = ref(""), sel = ref(0), inp = ref<HTMLInputElement | null>(null);
// the journal's own queries (same keys as the Journal and the + sheet, so one cache), read only while it is open
const nights = useQuery({ queryKey: ["journal", "nights"], queryFn: () => api.get<NightRow[]>("/nights", { all: 1 }), enabled: open });
const dreams = useQuery({ queryKey: ["journal", "dreams"], queryFn: () => api.get<DreamRow[]>("/dreams", { limit: DREAM_LIMIT }), enabled: open });
// as the + sheet: No recall goes once last night is logged (a night that is only tonight's plan is not logged)
const lastLogged = computed(() => { const n = nightOfDate(nights.data.value ?? [], today.value); return !!n && !isPlanOnly(n); });
// as the + sheet: in the morning Write a dream opens last night's still, dim capture; later in the day the plain editor
function write() {
  const morning = new Date().getHours() < 12;
  router.push({ name: "journal-write", params: { id: uuidv7() }, query: { new: "1", ...(morning ? { date: today.value } : {}) } });
}
async function noRecall() { try { await markNoRecall(today.value); toast("No recall logged"); } catch (e) { toastError(e); } }
type Item = { label: string; hint: string; icon: string; run: () => void };
const go = (e: { label: string; hint: string; icon: string; to: string }): Item => ({ label: e.label, hint: e.hint, icon: e.icon, run: () => router.push(e.to) });
const items = computed<Item[]>(() => {
  const t = q.value.toLowerCase().trim();
  const all: Item[] = [
    { label: "Write a dream", hint: "Action", icon: "book", run: write },
    ...(!lastLogged.value && !nights.isPending.value ? [{ label: "No recall last night", hint: "Action", icon: "moon", run: () => void noRecall() }] : []),
    { label: "Log a reality check", hint: "Action", icon: "eye", run: () => router.push("/check") },
    { label: "Plan tonight", hint: "Action", icon: "target", run: () => router.push("/train/tonight") },
    ...NAV.map((n) => ({ label: n.label, hint: "Page", icon: n.icon, run: () => router.push(n.to) })),
    // the long lists only once something is typed, so an empty search is the actions and pages
    ...(t.length > 1 ? [
      ...knowledgeEntries.value.map(go),
      ...SETTINGS_ENTRIES.map(go),
      ...(dreams.data.value ?? []).filter((d) => d.title?.trim().toLowerCase().includes(t)).slice(0, 20)
        .map((d) => ({ label: d.title!.trim(), hint: "Dream", icon: "book", run: () => router.push(`/journal/dream/${d.id}`) })),
    ] : []),
  ];
  return (t ? all.filter((i) => i.label.toLowerCase().includes(t)) : all).slice(0, 12);
});
function key(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); open.value = !open.value; q.value = ""; sel.value = 0; nextTick(() => inp.value?.focus()); return; }
  if (!open.value) return;
  if (e.key === "Escape") open.value = false;
  // the search field is the only stop inside, so Tab stays in it rather than wandering into the page behind
  if (e.key === "Tab") e.preventDefault();
  if (e.key === "ArrowDown") { sel.value = Math.min(items.value.length - 1, sel.value + 1); e.preventDefault(); }
  if (e.key === "ArrowUp") { sel.value = Math.max(0, sel.value - 1); e.preventDefault(); }
  if (e.key === "Enter") pick(items.value[sel.value]);
}
const pick = (i?: Item) => { if (!i) return; open.value = false; i.run(); };
// the page behind stays still while it is open
let unlock = () => {};
// focus goes back to where it was when it closes
let back: HTMLElement | null = null;
watch(open, (o) => {
  unlock(); unlock = o ? lockScroll() : () => {};
  if (o) { void loadKnowledge(); back = document.activeElement as HTMLElement | null; } else { const b = back; back = null; nextTick(() => { if (b?.isConnected) b.focus(); }); }
});
onMounted(() => addEventListener("keydown", key));
onBeforeUnmount(() => { removeEventListener("keydown", key); unlock(); });
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="scr" style="align-items:flex-start;padding-top:12vh" @mousedown.self="open = false">
      <div class="sht" style="width:min(560px,100%)" role="dialog" aria-modal="true" aria-label="Go anywhere">
        <div class="search" style="margin:14px"><Icon name="search" :size="18" /><input ref="inp" v-model="q" placeholder="Search actions, pages, techniques, articles and dreams" aria-label="Search actions, pages, techniques, articles and dreams" role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="cmdk-l" :aria-activedescendant="items.length ? 'cmdk-' + sel : undefined" @input="sel = 0" /></div>
        <div id="cmdk-l" class="sh_b" role="listbox" aria-label="Results" style="padding:0 8px 10px">
          <div v-for="(i, k) in items" :id="'cmdk-' + k" :key="i.hint + i.label + k" class="li click" role="option" :aria-selected="k === sel" :style="k === sel ? { background: 'var(--s2)', borderRadius: 'var(--r-sm)' } : undefined" style="padding:9px 10px;min-height:0;border:0" @mouseenter="sel = k" @click="pick(i)">
            <Icon :name="i.icon" :size="18" class="muted" /><span class="grow">{{ i.label }}</span><span class="tiny">{{ i.hint }}</span></div>
          <div v-if="!items.length" class="tiny" style="padding:10px">Nothing found</div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
