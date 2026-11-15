<script setup lang="ts">
// The Signs list (PLAN.md §6.4), in the order to act on: the dream sign shortlist with the check to pair with each,
// recurring dreams grouped with what keeps coming back in them (LDJ-164), suggestions to confirm, merge or dismiss, which signs turned up in lucid dreams, the typical themes beside the
// published figures (optional, ThemesCard), and last every element by kind with its trend, folded by kind.
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { elementsByKind, elementSuggestions, frequencyText, recurringGroups, signsBeforeLucidity, themeComparison, topSigns, type Element, type ElementKind, type RecurringGroup } from "@somnium/shared";
import { confirmElement, dismissElement, mergeElements, setElementFlags, signLexicons } from "../../api/signs";
import { choose, confirm } from "../../core/ask";
import { useFmt } from "../../core/format";
import { toast, toastError } from "../../core/toast";
import { uuidv7 } from "../../api/journal";
import Icon from "../Icon.vue";
import Menu from "../Menu.vue";
import Sparkline from "../Sparkline.vue";
import ThemesCard from "./ThemesCard.vue";
import { useSettings } from "../../api/queries";
import { CATEGORY_LABEL, KIND_LABEL, KIND_ONE, dreamsText, useSigns } from "./useSigns";

const props = defineProps<{ selected?: string }>();
const emit = defineEmits<{ open: [id: string] }>();
const fmt = useFmt();
const { today, elements, links, dreams, byId, stats, target } = useSigns();

// recurring dreams (marked "recurring") joined by shared elements; their content ranks first (shared signs.ts, RESEARCH.md C17)
const recurring = computed(() => recurringGroups(elements.value, links.value, dreams.value));
const shortlist = computed(() => topSigns(elements.value, links.value, dreams.value, signLexicons.value?.checks ?? [], today.value, undefined, { stats: stats.value, groups: recurring.value, target: target.value }));
const search = ref("");
const groups = computed(() => elementsByKind(elements.value, stats.value, search.value));
const suggestions = computed(() => elementSuggestions(elements.value, links.value, stats.value));
const lucid = computed(() => signsBeforeLucidity(elements.value, links.value, dreams.value));
// the typical themes you have as elements, so the themes card's rows open them
const themeEls = computed(() => new Map(themeComparison(elements.value, stats.value, signLexicons.value?.themes ?? []).map((t) => [t.theme.id, t.element.id])));
const settings = useSettings();
// folded by kind; the kind of the element open beside the list stays open, and a search opens every kind it matches
const opened = ref(new Set<ElementKind>());
const selectedKind = computed(() => (props.selected ? byId.value.get(props.selected)?.kind : undefined));
const isOpen = (k: ElementKind) => !!search.value.trim() || opened.value.has(k) || selectedKind.value === k;
function toggle(k: ElementKind) {
  const next = new Set(opened.value);
  if (isOpen(k)) next.delete(k); else next.add(k);
  opened.value = next;
}
const router = useRouter();
const write = () => router.push({ name: "journal-write", params: { id: uuidv7() }, query: { new: "1" } });
// the reality check paired with a sign, logged against that sign (CheckScreen reads kind and sign)
const doCheck = (kind: string, sign: string) => router.push({ name: "check", query: { kind, sign } });
const seen = (d: string | null) => (d ? `last ${fmt.value.date(d, { day: "numeric", month: "short" })}` : "");

const busy = ref("");
async function run(id: string, f: () => Promise<void>, done: string) {
  busy.value = id;
  try { await f(); toast(done); } catch (e) { toastError(e); } finally { busy.value = ""; }
}
const confirmOne = (e: Element) => run(e.id, () => confirmElement(e.id), "Confirmed");
// confirmed and marked in one step; both are plain flags, so this saves offline too (api/signs.ts setElementFlags)
const confirmSign = (e: Element) => run(e.id, () => setElementFlags(e.id, { confirmed: true, isDreamSign: true }), "Marked as a dream sign");
// a recurring dream's content marked in one step, each a plain flag through the outbox, so it saves offline too
const unmarked = (g: RecurringGroup<Element>) => g.core.filter((c) => !c.element.isDreamSign).map((c) => c.element);
const groupOn = (g: RecurringGroup<Element>) => g.core.some((c) => c.element.id === props.selected);
const markGroup = (g: RecurringGroup<Element>) => run(g.dreamIds[0]!, async () => {
  for (const e of unmarked(g)) await setElementFlags(e.id, { confirmed: true, isDreamSign: true });
}, "Marked as a dream sign");
async function mergeOne(e: Element) {
  // the same kind first, most dreams first: what it is most likely a second name for
  const others = elements.value.filter((x) => x.id !== e.id && x.name)
    .sort((a, b) => Number(b.kind === e.kind) - Number(a.kind === e.kind) || (stats.value.get(b.id)?.dreamCount ?? 0) - (stats.value.get(a.id)?.dreamCount ?? 0)).slice(0, 40);
  if (!others.length) { toast("There is nothing else to merge it into yet"); return; }
  const into = await choose(`Merge "${e.name}" into`, others.map((x) => ({ label: `${x.name} · ${KIND_ONE[x.kind]}`, value: x.id })), "Its dreams move over, and its name is kept as another name for the one you pick.");
  const target = into ? byId.value.get(into) : undefined;
  if (target) await run(e.id, () => mergeElements(e, target), "Merged");
}
async function dismissOne(e: Element) {
  if (!(await confirm(`Dismiss "${e.name}"?`, { text: "It comes off the dreams it was found in and isn't suggested for them again.", ok: "Dismiss", danger: true }))) return;
  await run(e.id, () => dismissElement(e, links.value), "Dismissed");
}
</script>

<template>
  <div>
    <!-- in the order to act on (PLAN.md §6.4, LDJ-125): your signs and their check, what to confirm, then the reference lists -->
    <div class="sh first"><h2>Your dream signs</h2><span class="tiny">{{ shortlist.length ? "Ranked by how often, how lately and the kind of sign" : "" }}</span></div>
    <div class="card sgshort">
      <div v-if="!shortlist.length" class="empty sm">
        <Icon name="sparkle" :size="34" /><b>No dream signs yet</b>
        A sign shows here once it turns up in 3 dreams, or in 2 within a month, and is an odd kind of thing (LaBerge's inner awareness, action, form or context) or one you marked as a dream sign.
      </div>
      <div v-else class="list">
        <div v-for="(s, i) in shortlist" :key="s.element.id" class="li sgrow" :class="{ on: selected === s.element.id }">
          <span class="bi sg sgrank num">{{ i + 1 }}</span>
          <span class="grow sgmin sgcol">
            <button type="button" class="sgopen sgcol" :aria-current="(selected === s.element.id) || undefined" @click="emit('open', s.element.id)">
              <span class="t">{{ s.element.name }}</span>
              <span class="s">{{ [s.category ? CATEGORY_LABEL[s.category] : s.element.isDreamSign ? "Marked by you" : "", s.recurring ? "Recurring dream" : "", frequencyText(s.frequency)].filter(Boolean).join(" · ") }}</span>
            </button>
            <span v-if="s.check" class="tiny sgcheck"><Icon name="target" :size="16" /><span>Check: {{ s.check.name }}. {{ s.advice }} <button type="button" class="lnk inl" @click="doCheck(s.check.id, s.element.id)">Do this check</button></span></span>
          </span>
        </div>
      </div>
    </div>

    <!-- recurring dreams (LDJ-164): absent until a dream is marked recurring -->
    <template v-if="recurring.length">
      <div class="sh"><h2>Recurring dreams</h2><span class="tiny">What keeps coming back is your most reliable dream sign</span></div>
      <div class="card"><div class="list">
        <div v-for="g in recurring" :key="g.dreamIds[0]" class="li sgrow" :class="{ on: groupOn(g) }">
          <button v-if="g.core.length" type="button" class="grow sgmin sgopen sgcol" :aria-current="groupOn(g) || undefined" @click="emit('open', g.core[0]!.element.id)">
            <span class="t ellipsis">{{ g.core.map((c) => c.element.name).join(" · ") }}</span>
            <span class="s">{{ [dreamsText(g.dreamIds.length), seen(g.lastSeen)].filter(Boolean).join(" · ") }}</span>
          </button>
          <span v-else class="grow sgmin sgcol">
            <span class="t">A recurring dream</span>
            <span class="s">{{ seen(g.lastSeen) }} · add who and what was in it to make it a dream sign</span>
          </span>
          <button v-if="unmarked(g).length" type="button" class="qb" :disabled="busy === g.dreamIds[0]" @click="markGroup(g)"><Icon name="sparkle" :size="16" />Mark as dream sign</button>
          <span v-else-if="g.core.length" class="tiny sgacc sgmark"><Icon name="sparkle" :size="16" />Dream sign</span>
        </div>
      </div></div>
    </template>

    <template v-if="suggestions.length">
      <div class="sh"><h2>Suggested from your dreams<span class="ncnt sgcnt" :aria-label="`${suggestions.length} to confirm`">{{ suggestions.length }}</span></h2><span class="tiny">Found by the app in more than one dream · confirm to keep them</span></div>
      <div class="card"><div class="list">
        <div v-for="s in suggestions" :key="s.element.id" class="li sgrow" :class="{ on: selected === s.element.id }">
          <button type="button" class="grow sgmin sgopen sgcol" @click="emit('open', s.element.id)"><span class="t ellipsis">{{ s.element.name }}</span><span class="s">{{ KIND_ONE[s.element.kind] }} · found in {{ dreamsText(s.stat.dreamCount) }}</span></button>
          <button type="button" class="qb" :disabled="busy === s.element.id" @click="confirmOne(s.element)"><Icon name="check" :size="16" />Confirm</button>
          <Menu :items="[{ label: 'Confirm as a dream sign', icon: 'sparkle', run: () => confirmSign(s.element) }, { label: 'Merge into another', icon: 'layers', run: () => mergeOne(s.element) }, { label: 'Dismiss', icon: 'close', danger: true, run: () => dismissOne(s.element) }]" />
        </div>
      </div></div>
    </template>

    <div class="sh"><h2>Signs in lucid dreams</h2></div>
    <div class="card">
      <div v-if="!lucid.enough" class="empty sm"><Icon name="layers" :size="34" /><b>Not enough dreams yet</b>This compares lucid and other dreams once you have written {{ lucid.needed }} ({{ lucid.dreams }} so far).</div>
      <template v-else>
        <p class="tiny sgmut">Each sign's count in your {{ dreamsText(lucid.lucidDreams).replace("dream", "lucid dream") }} and in your {{ lucid.otherDreams }} other {{ lucid.otherDreams === 1 ? "dream" : "dreams" }}. Plain counts: with this few dreams a difference can easily be chance.</p>
        <div v-if="!lucid.rows.length" class="empty sm"><Icon name="sparkle" :size="34" /><b>No dream signs in your dreams yet</b>Signs show here once they turn up in your dreams.</div>
        <div v-else class="list">
          <button v-for="r in lucid.rows.slice(0, 8)" :key="r.element.id" type="button" class="li click sgrow" @click="emit('open', r.element.id)">
            <span class="grow sgmin t ellipsis">{{ r.element.name }}</span>
            <span class="tiny num">{{ r.inLucid }} lucid · {{ r.inOther }} other</span><Icon name="right" :size="16" class="muted" />
          </button>
        </div>
      </template>
    </div>

    <!-- optional (Settings · Features); its one home (PLAN.md §6.4, LDJ-124) -->
    <ThemesCard v-if="settings.features.typicalThemes" :elements="themeEls" @open="emit('open', $event)" />

    <!-- the reference list last, each kind folded until opened (a search opens every kind it matches) -->
    <div class="sh"><h2>Everything in your dreams</h2><span class="tiny">{{ elements.length ? `${elements.length} in all` : "" }}</span></div>
    <div v-if="elements.length" class="search sgsearch"><Icon name="search" :size="18" /><input v-model="search" type="search" placeholder="Search elements" aria-label="Search elements" /></div>
    <div v-if="!elements.length" class="card empty sm"><Icon name="layers" :size="34" /><b>No elements yet</b>The people, places, things and feelings in your dreams show here once you add them to a dream.<br /><button class="btn tonal" type="button" @click="write">Write a dream</button></div>
    <div v-else-if="!groups.length" class="card empty sm"><Icon name="search" :size="34" /><b>Nothing matches</b>No element has that name.<br /><button class="btn tonal" type="button" @click="search = ''">Clear search</button></div>
    <section v-for="g in groups" :key="g.kind">
      <div class="card">
        <button type="button" class="lbl sgk" :aria-expanded="isOpen(g.kind)" @click="toggle(g.kind)">
          <span class="grow">{{ KIND_LABEL[g.kind] }}</span><span class="tiny sgn num">{{ g.rows.length }}</span><Icon :name="isOpen(g.kind) ? 'up' : 'down'" :size="16" class="muted" />
        </button>
        <div v-if="isOpen(g.kind)" class="list">
          <button v-for="r in g.rows" :key="r.element.id" type="button" class="li click sgrow" :class="{ on: selected === r.element.id }" :aria-current="(selected === r.element.id) || undefined" @click="emit('open', r.element.id)">
            <span class="grow sgmin sgcol"><span class="t ellipsis">{{ r.element.name }}<Icon v-if="r.element.isDreamSign" name="sparkle" :size="16" class="sgacc" aria-label="Dream sign" /></span>
              <span class="s">{{ [dreamsText(r.stat.dreamCount), seen(r.stat.lastSeen)].filter(Boolean).join(" · ") }}</span></span>
            <span class="sgspark" :title="'Last 12 weeks'"><Sparkline :values="r.stat.weekly" /></span><Icon name="right" :size="16" class="muted" />
          </button>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.sgrow { width: 100%; background: none; border-left: 0; border-right: 0; border-top: 0; color: var(--tx); text-align: start; font: inherit; }
button.sgrow { cursor: pointer; }
.sgrow.on { background: var(--s2); }
.sgmin { min-width: 0; }
/* spans inside the row buttons (a button may only hold phrasing content), stacked as the divs were */
.sgcol { display: flex; flex-direction: column; }
.sgopen { background: none; border: 0; padding: 0; color: inherit; font: inherit; text-align: start; cursor: pointer; }
.sgrank { font-weight: 600; align-self: flex-start; }
.sgcheck { color: var(--tx2); display: flex; gap: var(--tdy); align-items: flex-start; margin-top: var(--tdy); }
.sgcheck :deep(svg) { flex: none; margin-top: calc(var(--tdy) / 3); color: var(--acc); }
.sgspark { width: calc(var(--lmh) * 1.75); height: calc(var(--lmh) / 2); flex: none; }
/* the Motus sparkline sits at the foot of a stat card; here it is a small trend in the row */
.sgspark :deep(.spark) { position: static; display: block; width: 100%; height: 100%; }
.sgacc { color: var(--acc); margin-inline-start: var(--tdy); vertical-align: -0.1em; display: inline-block; }
.sgmark { display: inline-flex; align-items: center; gap: var(--tdy); flex: none; }
.sgmut { color: var(--tx2); margin: 0 0 var(--hg); }
.sgsearch { margin-bottom: var(--hg); }
/* the icon's room comes from the shared .search rule */
section + section > .card { margin-top: var(--hg); }
/* the kind's head is the button that folds it: a full-width .lbl row, like Motus's in-card titles */
.sgk { display: flex; align-items: center; gap: var(--tdy); width: 100%; background: none; border: 0; padding: var(--cpy) var(--cpx); color: inherit; font: inherit; text-align: start; cursor: pointer; }
.sgk[aria-expanded="true"] { padding-bottom: 0; }
.sgcnt { margin-inline-start: var(--tdy); vertical-align: 0.15em; }
</style>
