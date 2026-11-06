<script setup lang="ts">
// The Signs list (PLAN.md §6.3): the dream sign shortlist, every element by kind with its trend, suggestions to
// confirm, merge or dismiss, which signs turned up in lucid dreams, and the typical themes beside Nielsen's figures.
import { computed, ref } from "vue";
import { elementsByKind, elementSuggestions, frequencyText, signsBeforeLucidity, signShortlist, themeComparison, type Element } from "@somnium/shared";
import { confirmElement, dismissElement, mergeElements, signLexicons } from "../../api/signs";
import { choose, confirm } from "../../core/ask";
import { useFmt } from "../../core/format";
import { toast, toastError } from "../../core/toast";
import Icon from "../Icon.vue";
import Menu from "../Menu.vue";
import Sparkline from "../Sparkline.vue";
import { CATEGORY_LABEL, KIND_LABEL, KIND_ONE, dreamsText, useSigns } from "./useSigns";

defineProps<{ selected?: string }>();
const emit = defineEmits<{ open: [id: string] }>();
const fmt = useFmt();
const { today, elements, links, dreams, byId, stats } = useSigns();

const shortlist = computed(() => signShortlist(elements.value, stats.value, dreams.value, signLexicons.value?.checks ?? [], today.value));
const search = ref("");
const groups = computed(() => elementsByKind(elements.value, stats.value, search.value));
const suggestions = computed(() => elementSuggestions(elements.value, links.value, stats.value));
const lucid = computed(() => signsBeforeLucidity(elements.value, links.value, dreams.value));
const themes = computed(() => themeComparison(elements.value, stats.value, signLexicons.value?.themes ?? []));
const seen = (d: string | null) => (d ? `last ${fmt.value.date(d, { day: "numeric", month: "short" })}` : "");

const busy = ref("");
async function run(id: string, f: () => Promise<void>, done: string) {
  busy.value = id;
  try { await f(); toast(done); } catch (e) { toastError(e); } finally { busy.value = ""; }
}
const confirmOne = (e: Element) => run(e.id, () => confirmElement(e.id), "Confirmed");
async function mergeOne(e: Element) {
  // the same kind first, most dreams first: what it is most likely a second name for
  const others = elements.value.filter((x) => x.id !== e.id && x.name)
    .sort((a, b) => Number(b.kind === e.kind) - Number(a.kind === e.kind) || (stats.value.get(b.id)?.dreamCount ?? 0) - (stats.value.get(a.id)?.dreamCount ?? 0)).slice(0, 40);
  if (!others.length) { toast("There is nothing else to merge it into yet"); return; }
  const into = await choose(`Merge "${e.name}" into`, others.map((x) => ({ label: `${x.name} · ${KIND_ONE[x.kind]}`, value: x.id })), "Its dreams move over, and its name is kept as another name for the one you pick.");
  const target = into ? byId.value.get(into) : undefined;
  if (target) await run(e.id, () => mergeElements(e, target, links.value), "Merged");
}
async function dismissOne(e: Element) {
  if (!(await confirm(`Dismiss "${e.name}"?`, { text: "It comes off the dreams it was found in and isn't suggested for them again.", ok: "Dismiss", danger: true }))) return;
  await run(e.id, () => dismissElement(e, links.value, dreams.value), "Dismissed");
}
</script>

<template>
  <div>
    <div class="sh first"><h2>Your dream signs</h2><span class="tiny">{{ shortlist.length ? "Ranked by how often and how lately" : "" }}</span></div>
    <div class="card sgshort">
      <div v-if="!shortlist.length" class="empty sm">
        <b>No dream signs yet</b>
        A sign shows here once it turns up in 3 dreams, or in 2 within a month, and is an odd kind of thing (LaBerge's inner awareness, action, form or context) or one you marked as a dream sign.
      </div>
      <div v-else class="list">
        <button v-for="(s, i) in shortlist" :key="s.element.id" class="li click sgrow" :class="{ on: selected === s.element.id }" @click="emit('open', s.element.id)">
          <span class="sgrank num">{{ i + 1 }}</span>
          <div class="grow sgmin">
            <div class="t">{{ s.element.name }}</div>
            <div class="s">{{ [s.category ? CATEGORY_LABEL[s.category] : "Marked by you", frequencyText(s.frequency)].join(" · ") }}</div>
            <div v-if="s.check" class="tiny sgcheck"><Icon name="target" :size="13" /><span>Check: {{ s.check.name }}. {{ s.advice }}</span></div>
          </div>
        </button>
      </div>
    </div>

    <div class="sh"><h2>Elements</h2><span class="tiny">{{ elements.length ? `${elements.length} in all` : "" }}</span></div>
    <div v-if="elements.length" class="search sgsearch"><Icon name="search" :size="18" /><input v-model="search" type="search" placeholder="Search elements" aria-label="Search elements" /></div>
    <div v-if="!elements.length" class="card empty sm">The people, places, things and feelings in your dreams show here once you add them to a dream.</div>
    <div v-else-if="!groups.length" class="card empty sm">Nothing matches.</div>
    <section v-for="g in groups" :key="g.kind">
      <div class="sh sgk"><h3>{{ KIND_LABEL[g.kind] }}</h3><span class="tiny">{{ g.rows.length }}</span></div>
      <div class="card"><div class="list">
        <button v-for="r in g.rows" :key="r.element.id" class="li click sgrow" :class="{ on: selected === r.element.id }" @click="emit('open', r.element.id)">
          <div class="grow sgmin"><div class="t ellipsis">{{ r.element.name }}<Icon v-if="r.element.isDreamSign" name="sparkle" :size="13" class="sgacc" aria-label="Dream sign" /></div>
            <div class="s">{{ [dreamsText(r.stat.dreamCount), seen(r.stat.lastSeen)].filter(Boolean).join(" · ") }}</div></div>
          <div class="sgspark" :title="'Last 12 weeks'"><Sparkline :values="r.stat.weekly" /></div>
        </button>
      </div></div>
    </section>

    <template v-if="suggestions.length">
      <div class="sh"><h2>To confirm</h2><span class="tiny">Found by the app in more than one dream</span></div>
      <div class="card"><div class="list">
        <div v-for="s in suggestions" :key="s.element.id" class="li sgrow">
          <button class="grow sgmin sgopen" @click="emit('open', s.element.id)"><div class="t ellipsis">{{ s.element.name }}</div><div class="s">{{ KIND_ONE[s.element.kind] }} · found in {{ dreamsText(s.stat.dreamCount) }}</div></button>
          <button class="qb acc" :disabled="busy === s.element.id" @click="confirmOne(s.element)"><Icon name="check" :size="16" />Confirm</button>
          <Menu :items="[{ label: 'Merge into another', icon: 'layers', run: () => mergeOne(s.element) }, { label: 'Dismiss', icon: 'close', danger: true, run: () => dismissOne(s.element) }]" />
        </div>
      </div></div>
    </template>

    <div class="sh"><h2>Signs in lucid dreams</h2></div>
    <div class="card">
      <div v-if="!lucid.enough" class="empty sm">Not enough dreams yet. This compares lucid and other dreams once you have written {{ lucid.needed }} ({{ lucid.dreams }} so far).</div>
      <template v-else>
        <p class="tiny sgmut">Each sign's count in your {{ dreamsText(lucid.lucidDreams).replace("dream", "lucid dream") }} and in your {{ lucid.otherDreams }} other {{ lucid.otherDreams === 1 ? "dream" : "dreams" }}. Plain counts: with this few dreams a difference can easily be chance.</p>
        <div v-if="!lucid.rows.length" class="empty sm">No dream signs in your dreams yet.</div>
        <div v-else class="list">
          <button v-for="r in lucid.rows.slice(0, 8)" :key="r.element.id" class="li click sgrow" @click="emit('open', r.element.id)">
            <div class="grow sgmin t ellipsis">{{ r.element.name }}</div>
            <span class="tiny num">{{ r.inLucid }} lucid · {{ r.inOther }} other</span>
          </button>
        </div>
      </template>
    </div>

    <template v-if="themes.length">
      <div class="sh"><h2>Typical dream themes</h2></div>
      <div class="card">
        <p class="tiny sgmut">Yours is how many of your written dreams had the theme. Beside it, the share of 1,181 Canadian students who said they had ever had it (Nielsen and others, 2003). They measure different things (a count against a lifetime share), so they can't be compared directly.</p>
        <div class="list">
          <button v-for="t in themes" :key="t.theme.id" class="li click sgrow" @click="emit('open', t.element.id)">
            <div class="grow sgmin"><div class="t">{{ t.theme.displayName ?? t.theme.name }}</div><div class="s">{{ t.theme.prevalenceTotal }}% have ever had it</div></div>
            <span class="num sgcount">{{ t.yourDreams }}</span>
          </button>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.sgrow { width: 100%; background: none; border-left: 0; border-right: 0; border-top: 0; color: var(--tx); text-align: start; font: inherit; }
button.sgrow { cursor: pointer; }
.sgrow.on { background: var(--s2); }
.sgmin { min-width: 0; }
.sgopen { background: none; border: 0; padding: 0; color: inherit; font: inherit; text-align: start; cursor: pointer; }
.sgrank { width: 22px; flex: none; color: var(--acc); font-weight: 600; text-align: center; align-self: flex-start; }
.sgcheck { color: var(--tx2); display: flex; gap: 6px; align-items: flex-start; margin-top: 4px; }
.sgcheck :deep(svg) { flex: none; margin-top: 2px; color: var(--acc); }
.sgspark { width: 84px; height: 26px; flex: none; }
/* the Motus sparkline sits at the foot of a stat card; here it is a small trend in the row */
.sgspark :deep(.spark) { position: static; display: block; width: 100%; height: 100%; }
.sgacc { color: var(--acc); margin-inline-start: 6px; vertical-align: -1px; display: inline-block; }
.sgmut { color: var(--tx2); margin: 0 0 var(--hg); }
.sgsearch { margin-bottom: var(--hg); }
.sgsearch input { width: 100%; padding-left: 38px; }
.sgk { margin-top: var(--spg); }
.sgk h3 { margin: 0; font-size: 14px; }
.sgcount { font-weight: 600; min-width: 28px; text-align: end; }
</style>
