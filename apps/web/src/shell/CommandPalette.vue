<script setup lang="ts">
// Ctrl+K (or ⌘K): jump to any page by typing (an optional feature). Pages add their own entries as they come.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { lockScroll } from "../core/scrollLock";
import { useRouter } from "vue-router";
import { NAV } from "./nav";
import Icon from "../components/Icon.vue";

const router = useRouter();
const open = ref(false), q = ref(""), sel = ref(0), inp = ref<HTMLInputElement | null>(null);
type Item = { label: string; hint: string; icon: string; run: () => void };
const items = computed<Item[]>(() => {
  const t = q.value.toLowerCase().trim();
  const all: Item[] = [
    ...NAV.map((n) => ({ label: n.label, hint: "Page", icon: n.icon, run: () => router.push(n.to) })),
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
  if (o) back = document.activeElement as HTMLElement | null; else { const b = back; back = null; nextTick(() => { if (b?.isConnected) b.focus(); }); }
});
onMounted(() => addEventListener("keydown", key));
onBeforeUnmount(() => { removeEventListener("keydown", key); unlock(); });
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="scr" style="align-items:flex-start;padding-top:12vh" @mousedown.self="open = false">
      <div class="sht" style="width:min(560px,100%)" role="dialog" aria-modal="true" aria-label="Go to a page">
        <div class="search" style="margin:14px"><Icon name="search" :size="18" /><input ref="inp" v-model="q" placeholder="Type a page" aria-label="Type a page" role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="cmdk-l" :aria-activedescendant="items.length ? 'cmdk-' + sel : undefined" @input="sel = 0" /></div>
        <div id="cmdk-l" class="sh_b" role="listbox" aria-label="Pages" style="padding:0 8px 10px">
          <div v-for="(i, k) in items" :id="'cmdk-' + k" :key="i.hint + i.label" class="li click" role="option" :aria-selected="k === sel" :style="k === sel ? { background: 'var(--s2)', borderRadius: 'var(--r-sm)' } : undefined" style="padding:9px 10px;min-height:0;border:0" @mouseenter="sel = k" @click="pick(i)">
            <Icon :name="i.icon" :size="18" class="muted" /><span class="grow">{{ i.label }}</span><span class="tiny">{{ i.hint }}</span></div>
          <div v-if="!items.length" class="tiny" style="padding:10px">Nothing found</div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
