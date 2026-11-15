<script setup lang="ts">
// Journal (PLAN.md §6.2): nights newest first or a month calendar, search on the device, "no recall" in one tap,
// and writing a dream. No recall is on the Last night strip (LDJ-129) and, for older unlogged nights, the calendar day: adding otherwise lives in the
// + sheet (§6.0), which offers the same No recall last night. On a computer the dream opens in a panel beside the list; on the phone it is a step of its
// own (read, or write full screen). Everything shown and searched is the journal as opened on this device: a
// search never goes to the server. With day notes on, each note shows inside its day and opens to read and edit there
// (LDJ-123); writing one is in the + sheet, and an older day's from its calendar day, as for dreams.
import { computed, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { DREAM_FILTER_MARKS, NAP_FILTER, TECHNIQUES, dayMarks, filterActive, groupByNight, isPlanOnly, journalCount, journalNights, nightOfDate, searchJournal, techniquesDoneOf, type DreamFilterMark, type JournalFilter } from "@somnium/shared";
import { loaded, useSettings } from "../api/queries";
import { useDayNotes, waitingDayNotes } from "../api/extras";
import { DREAM_LIMIT, markNoRecall, onDevice, saveState, unsent, useJournal, uuidv7 } from "../api/journal";
import { isPhone } from "../core/device";
import { useFmt } from "../core/format";
import { useToday } from "../core/today";
import { readStr, writeStr } from "../core/prefs";
import { toast, toastError } from "../core/toast";
import { confirm } from "../core/ask";
import Icon from "../components/Icon.vue";
import Menu from "../components/Menu.vue";
import Sheet from "../components/Sheet.vue";
import FilterPanel from "../components/FilterPanel.vue";
import FilterRow from "../components/FilterRow.vue";
import DatePicker from "../components/DatePicker.vue";
import NightList from "../components/journal/NightList.vue";
import NightSheet from "../components/journal/NightSheet.vue";
import NightCheckIn from "../components/journal/NightCheckIn.vue";
import JournalCalendar from "../components/journal/JournalCalendar.vue";
import ImportFlow from "../components/settings/ImportFlow.vue";
import DreamView from "../components/journal/DreamView.vue";
import DreamEditor from "../components/journal/DreamEditor.vue";
import DayNoteCard from "../components/home/DayNoteCard.vue";

const route = useRoute(), router = useRouter();
const fmt = useFmt();
const j = useJournal();
await loaded(j.nights, j.dreams);
// reactive: the page can stay open across midnight
const today = useToday();

// which view was last used is a convenience of this device, nothing personal
const view = ref<"list" | "calendar">(readStr("somniumJournalView", "list") === "calendar" ? "calendar" : "list");
const setView = (v: "list" | "calendar") => { view.value = v; writeStr("somniumJournalView", v); };

// a night that is only a plan (Train's "Use tonight") is not a logged morning: it shows once something is written
const groups = computed(() => groupByNight(journalNights(j.nights.data.value ?? [], today.value), j.dreams.data.value ?? []));
/** The logged night of a date: a plan alone doesn't hide "No recall". */
const loggedOn = (d: string) => { const n = nightOfDate(j.nights.data.value ?? [], d); return n && !isPlanOnly(n) ? n : undefined; };
const linksBy = computed(() => {
  const m = new Map<string, string[]>();
  for (const l of j.links.data.value ?? []) { const x = m.get(l.dreamId); if (x) x.push(l.elementId); else m.set(l.dreamId, [l.elementId]); }
  return m;
});
const byId = computed(() => new Map((j.elements.data.value ?? []).map((e) => [e.id, e])));
const counts = computed(() => new Map([...linksBy.value].map(([k, v]) => [k, v.length])));
const elementsOf = (id: string) => (linksBy.value.get(id) ?? []).map((eid) => ({ id: eid, name: byId.value.get(eid)?.name ?? null }));

// all of it runs here, over the journal as opened on this device (the server never sees a search, PLAN.md §4)
const filter = reactive<Required<JournalFilter>>({ text: "", elementIds: [], from: "", to: "", lucidOnly: false, marks: [], night: [] });
const shown = computed(() => searchJournal(groups.value, elementsOf, filter));
const active = computed(() => filterActive(filter));
const narrowed = computed(() => filter.elementIds.length + filter.marks.length + filter.night.length + (filter.from ? 1 : 0) + (filter.to ? 1 : 0) + (filter.lucidOnly ? 1 : 0));
const filterOpen = ref(false);
const clearFilter = () => Object.assign(filter, { elementIds: [], from: "", to: "", lucidOnly: false, marks: [], night: [] });
const named = computed(() => (j.elements.data.value ?? []).filter((e) => e.name).sort((a, b) => a.name!.localeCompare(b.name!)));
const flip = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
const toggleEl = (id: string) => { filter.elementIds = flip(filter.elementIds, id); };
const toggleMark = (k: DreamFilterMark) => { filter.marks = flip(filter.marks, k); };
const toggleNight = (k: string) => { filter.night = flip(filter.night, k); };
// the Night group (LDJ-163): WBTB always, then the techniques this journal has logged on some night, then Nap if any
const nightOptions = computed(() => {
  const nights = journalNights(j.nights.data.value ?? [], today.value);
  const used = new Set(nights.flatMap((n) => techniquesDoneOf(n)));
  const opts = TECHNIQUES.filter((t) => t.id === "wbtb" || used.has(t.id)).map((t) => ({ value: t.id, label: t.label }));
  if (nights.some((n) => n.nap)) opts.push({ value: NAP_FILTER, label: "Nap" });
  return opts;
});
// "12 dreams · lucid among these: 3 of 12": how often a kind of night or dream went lucid is the pattern worth seeing
const countLine = computed(() => {
  const c = journalCount(shown.value);
  if (!c.dreams) return "No dreams";
  const n = c.dreams === 1 ? "1 dream" : `${c.dreams} dreams`;
  return filter.lucidOnly ? n : `${n} · lucid among these: ${c.lucid} of ${c.dreams}`;
});
// what is narrowing the list, as chips above it: a tap takes one off
const fmtDay = (d: string) => fmt.value.date(d, { day: "numeric", month: "short", year: "numeric" });
const activeChips = computed(() => [
  ...(filter.lucidOnly ? [{ key: "lucid", label: "Lucid", off: () => (filter.lucidOnly = false) }] : []),
  ...filter.marks.map((m) => ({ key: "m" + m, label: DREAM_FILTER_MARKS.find((x) => x.key === m)?.label ?? m, off: () => toggleMark(m) })),
  ...filter.night.map((t) => ({ key: "n" + t, label: t === NAP_FILTER ? "Nap" : TECHNIQUES.find((x) => x.id === t)?.label ?? t, off: () => toggleNight(t) })),
  ...filter.elementIds.map((id) => ({ key: "e" + id, label: byId.value.get(id)?.name ?? "Element", off: () => toggleEl(id) })),
  ...(filter.from ? [{ key: "from", label: `From ${fmtDay(filter.from)}`, off: () => (filter.from = "") }] : []),
  ...(filter.to ? [{ key: "to", label: `To ${fmtDay(filter.to)}`, off: () => (filter.to = "") }] : []),
]);
// what a search covered: the device's own journal, or (no copy on this device) what the server sent, opened here
const searchNote = computed(() => {
  if (!active.value) return "";
  if (onDevice()) return "Searched on this device.";
  if ((j.dreams.data.value?.length ?? 0) >= DREAM_LIMIT) return `Searched on this device, in your newest ${DREAM_LIMIT} dreams. Older ones aren't searched here.`;
  return "Searched on this device, in what your server sent.";
});

const empty = computed(() => !groups.value.length);
const todayLogged = computed(() => !!loggedOn(today.value));
// Night details of any night, a no-recall one too (LDJ-99): opened from its row in the list or the calendar's day
const nightOpen = ref<string | null>(null);
const openNight = computed(() => (nightOpen.value ? j.nights.data.value?.find((n) => n.id === nightOpen.value) : undefined));

// day notes (optional): asked for only while the feature is on; the list shows them while nothing narrows it (a search
// is of dreams), a calendar day always shows its own
const settings = useSettings();
const notesOn = computed(() => !!settings.value.features.dayNotes);
const dayNotes = useDayNotes(notesOn);
const notes = computed(() => (notesOn.value ? dayNotes.data.value ?? [] : []));
const waitingNotes = computed(() => (notesOn.value ? waitingDayNotes.value : []));
const noteOpen = ref<string | null>(null);
const hasNote = (d: string) => waitingNotes.value.includes(d) || notes.value.some((n) => n.date === d && !!n.text?.trim());

// the calendar
const month = ref(today.value.slice(0, 7)), sel = ref(today.value);
const marks = computed(() => dayMarks(shown.value));
const dayGroups = computed(() => shown.value.filter((g) => g.night.date === sel.value));
const pick = (d: string) => { sel.value = d; if (d.slice(0, 7) !== month.value) month.value = d.slice(0, 7); };

// reading and writing
const mode = computed(() => (route.name === "journal-write" ? "write" : route.name === "journal-dream" ? "read" : null));
const id = computed(() => String(route.params.id ?? ""));
const date = computed(() => (typeof route.query.date === "string" ? route.query.date : undefined));
function write(d?: string) { router.push({ name: "journal-write", params: { id: uuidv7() }, query: { new: "1", ...(d ? { date: d } : {}) } }); }
const fresh = computed(() => route.query.new === "1");
// an unfinished dream (key words only) opens straight to writing it out (LDJ-162)
const finish = (did: string) => (mode.value ? router.replace : router.push)({ name: "journal-write", params: { id: did } });
const open = (did: string) => (mode.value ? router.replace : router.push)({ name: "journal-dream", params: { id: did } });
function closeWrite() {
  // written out from the capture after the WBTB alarm: on to the "I'm up" guide, as the capture itself would
  if (route.query.then === "up") router.replace("/train/guided/up");
  // a dream that was saved opens to read; one left empty was never made
  else if (saveState[id.value] || j.dreams.data.value?.some((x) => x.id === id.value)) router.replace({ name: "journal-dream", params: { id: id.value } });
  else if (history.state?.back) router.back(); else router.replace("/journal");
}
const closeRead = () => (history.state?.back ? router.back() : router.replace("/journal"));

async function noRecall(d: string) { try { await markNoRecall(d); } catch (e) { toastError(e); } }
// the morning reminder (PLAN.md §9, LDJ-30): its tap opens /journal?write=1&date=..., its "No recall" button
// /journal?norecall=... - here, behind the lock, because both need the journal's key. Each is done once, then the
// address goes back to plain /journal. No recall is written only after the person confirms it here.
const DATE = /^\d{4}-\d{2}-\d{2}$/;
watch(() => [route.name, route.query.write, route.query.norecall], async () => {
  if (route.name !== "journal") return;
  const q = route.query;
  if (q.write === "1") { router.replace({ name: "journal-write", params: { id: uuidv7() }, query: { new: "1", ...(typeof q.date === "string" && DATE.test(q.date) ? { date: q.date } : {}) } }); return; }
  if (typeof q.norecall === "string" && DATE.test(q.norecall)) {
    const d = q.norecall;
    await router.replace("/journal");
    // an address anyone can open (a link, another app): it only asks, the person says yes; a night with dreams is
    // never marked (markNoRecall refuses it)
    const night = fmt.value.date(d, { weekday: "long", day: "numeric", month: "long" });
    if (loggedOn(d)?.dreamCount) { toast("That night already has dreams"); return; }
    if (!(await confirm(`No recall for ${night}?`, { text: "Logs the night with no dreams remembered.", ok: "Log no recall" }))) return;
    try { await markNoRecall(d); toast("No recall logged"); } catch (e) { toastError(e); }
  }
}, { immediate: true });
// the import opens over the Journal and closes back to it once saved (LDJ-129)
const importOpen = ref(false);
const menu = computed(() => [
  { label: "Write a dream", icon: "plus", run: () => write(), hidden: !mode.value || isPhone.value },
  { label: "Search filters", icon: "filter", run: () => (filterOpen.value = true), hidden: empty.value },
  // the same import as Settings → Data (LDJ-16, LDJ-36): Markdown, text or CSV, dates found, a review before saving
  { label: "Import from a file", icon: "upload", run: () => (importOpen.value = true) },
]);
</script>

<template>
  <div class="page">
    <template v-if="isPhone && mode">
      <DreamEditor v-if="mode === 'write'" :id="id" :key="id" :date="date" :fresh="fresh" full @close="closeWrite" />
      <DreamView v-else :id="id" :key="'r' + id" back @edit="router.push({ name: 'journal-write', params: { id } })" @close="closeRead" />
    </template>
    <div v-else class="jcols" :class="{ split: !isPhone }">
      <div class="jlist">
        <div class="ph">
          <div><h1>Journal</h1></div>
          <div class="acts">
            <div v-if="!empty" class="seg"><button :class="{ on: view === 'list' }" :aria-pressed="view === 'list'" @click="setView('list')">List</button><button :class="{ on: view === 'calendar' }" :aria-pressed="view === 'calendar'" @click="setView('calendar')">Calendar</button></div>
            <Menu :items="menu" />
            <!-- with a dream open beside the list, its Edit or Done is the one primary button; this moves to the menu -->
            <button v-if="!empty && !isPhone && !mode" class="btn" @click="write()"><Icon name="plus" :size="16" />Write a dream</button>
          </div>
        </div>

        <!-- the page's one No recall, also above an empty journal -->
        <div v-if="!todayLogged" class="card jtoday"><div class="row"><Icon name="moon" :size="18" /><div class="grow"><div class="t">Last night</div><div class="tiny">Nothing written yet</div></div><button class="qb acc" @click="noRecall(today)">No recall</button></div></div>
        <!-- once last night is logged: did you do its techniques (LDJ-79), asked once -->
        <NightCheckIn v-else :key="loggedOn(today)!.id" :night="loggedOn(today)!" :nights="j.nights.data.value ?? []" card class="jtoday" />
        <div v-if="empty" class="card empty">
          <Icon name="book" :size="34" /><b>No dreams yet</b>Write down what you remember as soon as you wake. A fragment counts.
          <!-- the editor beside it has the screen's one action while it is open -->
          <template v-if="mode !== 'write'"><br /><button class="btn tonal" type="button" @click="write()">Write a dream</button></template>
        </div>
        <template v-else>
          <div v-if="unsent.ids.length" class="card tiny jnote"><Icon name="lock" :size="14" />{{ unsent.ids.length === 1 ? "1 dream is" : `${unsent.ids.length} dreams are` }} kept sealed on this device until the server can take {{ unsent.ids.length === 1 ? "it" : "them" }}.</div>

          <template v-if="view === 'list'">
            <div class="jsearch">
              <div class="search grow"><Icon name="search" :size="18" /><input v-model="filter.text" type="search" placeholder="Search your dreams" aria-label="Search your dreams" /></div>
              <button class="ib sm" :class="{ on: narrowed }" aria-label="Search filters" @click="filterOpen = true"><Icon name="filter" :size="18" /></button>
            </div>
            <FilterPanel v-if="narrowed" :count="countLine" active @clear="clearFilter">
              <FilterRow label="Showing"><button v-for="c in activeChips" :key="c.key" class="fchip on" :aria-label="`Remove ${c.label}`" @click="c.off()">{{ c.label }}<Icon name="close" :size="14" /></button></FilterRow>
            </FilterPanel>
            <div v-else-if="active" class="tiny jmut jcount">{{ countLine }}</div>
            <div v-if="searchNote" class="tiny jmut">{{ searchNote }}</div>
            <div v-if="active && !shown.length" class="card empty sm"><Icon name="search" :size="34" /><b>Nothing matches</b>No dream fits this search and these filters.<br /><button class="btn tonal" type="button" @click="clearFilter">Clear filters</button></div>
            <NightList :groups="shown" :counts="counts" :selected="mode ? id : undefined" :notes="active ? [] : notes" :waiting="active ? [] : waitingNotes" @open="open" @finish="finish" @night="(n) => (nightOpen = n)" @note="(d) => (noteOpen = d)" />
          </template>
          <template v-else>
            <JournalCalendar v-model:month="month" :marks="marks" :selected="sel" @pick="pick" />
            <div class="sh"><h2>{{ fmt.date(sel, { weekday: "long", day: "numeric", month: "long" }) }}</h2>
              <span class="row">
                <!-- older nights only: last night has the strip and the + sheet; a logged night (dreams or no recall) has nothing to mark -->
                <button v-if="sel < today && !loggedOn(sel)" class="lnk" @click="noRecall(sel)">No recall</button>
                <button v-if="sel <= today" class="lnk" @click="write(sel)"><Icon name="plus" :size="14" />Dream</button>
                <button v-if="notesOn && sel <= today && !hasNote(sel)" class="lnk" @click="noteOpen = sel"><Icon name="plus" :size="14" />Day note</button>
              </span>
            </div>
            <div v-if="!dayGroups.length && !hasNote(sel)" class="card empty sm"><Icon name="book" :size="34" /><b>Nothing written for this night</b>Add what you remember from this night.<br /><button v-if="sel <= today" class="btn tonal" type="button" @click="write(sel)">Write a dream</button></div>
            <NightList :groups="dayGroups" :counts="counts" :selected="mode ? id : undefined" :notes="notes.filter((n) => n.date === sel)" :waiting="waitingNotes.filter((d) => d === sel)" bare @open="open" @finish="finish" @night="(n) => (nightOpen = n)" @note="(d) => (noteOpen = d)" />
          </template>
        </template>
      </div>
      <aside v-if="!isPhone" class="jside">
        <div class="card">
          <DreamEditor v-if="mode === 'write'" :id="id" :key="id" :date="date" :fresh="fresh" @close="closeWrite" />
          <DreamView v-else-if="mode === 'read'" :id="id" :key="'r' + id" @edit="router.push({ name: 'journal-write', params: { id } })" @close="closeRead" />
          <div v-else class="empty sm"><Icon name="book" :size="34" /><b>No dream open</b>Pick a dream from the list to read it here.</div>
        </div>
      </aside>
    </div>

    <NightSheet v-if="openNight" :key="openNight.id" :date="openNight.date" :nap="openNight.nap" :night-id="openNight.id" @close="nightOpen = null" />

    <!-- read and edit a day's note where it shows; saved as the field is left or the sheet closes -->
    <Sheet v-if="noteOpen && notesOn" title="Day note" @close="noteOpen = null">
      <DayNoteCard :key="noteOpen" :today="today" :date="noteOpen" bare />
    </Sheet>

    <Sheet v-if="importOpen" title="Import from a file" @close="importOpen = false">
      <div class="stack"><ImportFlow first @done="importOpen = false" /></div>
    </Sheet>

    <Sheet v-if="filterOpen" title="Search filters" @close="filterOpen = false">
      <label class="tgl"><div class="grow"><div class="t">Lucid dreams only</div></div><span class="tg"><input v-model="filter.lucidOnly" type="checkbox" /></span></label>
      <div class="g2 jg">
        <div class="fld"><label>From</label><DatePicker v-model="filter.from" :max="filter.to || today" clearable /></div>
        <div class="fld"><label>To</label><DatePicker v-model="filter.to" :min="filter.from || undefined" :max="today" clearable /></div>
      </div>
      <FilterRow label="Dream"><button v-for="m in DREAM_FILTER_MARKS" :key="m.key" class="fchip" :class="{ on: filter.marks.includes(m.key) }" :aria-pressed="filter.marks.includes(m.key)" @click="toggleMark(m.key)">{{ m.label }}</button></FilterRow>
      <FilterRow label="Night"><button v-for="o in nightOptions" :key="o.value" class="fchip" :class="{ on: filter.night.includes(o.value) }" :aria-pressed="filter.night.includes(o.value)" @click="toggleNight(o.value)">{{ o.label }}</button></FilterRow>
      <div class="fld"><label>Elements</label>
        <div v-if="named.length" class="chips"><button v-for="e in named" :key="e.id" class="fchip" :class="{ on: filter.elementIds.includes(e.id) }" :aria-pressed="filter.elementIds.includes(e.id)" @click="toggleEl(e.id)">{{ e.name }}</button></div>
        <div v-else class="tiny jmut">Elements you add to dreams show here.</div>
      </div>
      <template #foot><button class="btn o" :disabled="!narrowed" @click="clearFilter">Clear</button><button class="btn" @click="filterOpen = false">Show {{ journalCount(shown).dreams }}</button></template>
    </Sheet>
  </div>
</template>

<style scoped>
.jcols.split { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: var(--spg); align-items: start; }
.jlist { min-width: 0; }
.jside { position: sticky; top: var(--spg); min-width: 0; max-height: calc(100vh - 2 * var(--spg)); overflow-y: auto; }
.jsearch { display: flex; gap: 8px; align-items: center; margin-bottom: var(--hg); }
.jsearch .search { min-width: 0; }
.jsearch .search input { width: 100%; padding-left: 38px; }
.ib.on { color: var(--acc); border-color: var(--acc); }
.jnote { display: flex; gap: 8px; align-items: center; margin-bottom: var(--hg); color: var(--tx2); }
.jtoday { margin-bottom: var(--hg); }
.jtoday .t { font-weight: 500; }
.jcount { margin-bottom: 4px; }
.jg { gap: var(--lpy); }
.ph .acts { flex-wrap: wrap; justify-content: flex-end; }
</style>
