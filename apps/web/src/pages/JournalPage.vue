<script setup lang="ts">
// Journal (PLAN.md §6.2): nights newest first or a month calendar, search on the device, "no recall" in one tap,
// and writing a dream. On a computer the dream opens in a panel beside the list; on the phone it is a step of its
// own (read, or write full screen). Everything shown and searched is the journal as opened on this device: a
// search never goes to the server.
import { computed, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { dayMarks, filterActive, groupByNight, nightOfDate, searchJournal, type JournalFilter } from "@somnium/shared";
import { loaded } from "../api/queries";
import { DREAM_LIMIT, markNoRecall, onDevice, saveState, unsent, useJournal, uuidv7 } from "../api/journal";
import { isPhone } from "../core/device";
import { localYmd, useFmt } from "../core/format";
import { readStr, writeStr } from "../core/prefs";
import { toastError } from "../core/toast";
import Icon from "../components/Icon.vue";
import Menu from "../components/Menu.vue";
import Sheet from "../components/Sheet.vue";
import DatePicker from "../components/DatePicker.vue";
import NightList from "../components/journal/NightList.vue";
import JournalCalendar from "../components/journal/JournalCalendar.vue";
import DreamView from "../components/journal/DreamView.vue";
import DreamEditor from "../components/journal/DreamEditor.vue";

const route = useRoute(), router = useRouter();
const fmt = useFmt();
const j = useJournal();
await loaded(j.nights, j.dreams);
const today = localYmd(new Date());

// which view was last used is a convenience of this device, nothing personal
const view = ref<"list" | "calendar">(readStr("somniumJournalView", "list") === "calendar" ? "calendar" : "list");
const setView = (v: "list" | "calendar") => { view.value = v; writeStr("somniumJournalView", v); };

// a night planned in Train for the coming morning is not a logged night yet: it shows once its morning has come
const groups = computed(() => groupByNight((j.nights.data.value ?? []).filter((n) => n.date <= today), j.dreams.data.value ?? []));
const linksBy = computed(() => {
  const m = new Map<string, string[]>();
  for (const l of j.links.data.value ?? []) { const x = m.get(l.dreamId); if (x) x.push(l.elementId); else m.set(l.dreamId, [l.elementId]); }
  return m;
});
const byId = computed(() => new Map((j.elements.data.value ?? []).map((e) => [e.id, e])));
const counts = computed(() => new Map([...linksBy.value].map(([k, v]) => [k, v.length])));
const elementsOf = (id: string) => (linksBy.value.get(id) ?? []).map((eid) => ({ id: eid, name: byId.value.get(eid)?.name ?? null }));

const filter = reactive<Required<JournalFilter>>({ text: "", elementIds: [], from: "", to: "", lucidOnly: false });
const shown = computed(() => searchJournal(groups.value, elementsOf, filter));
const active = computed(() => filterActive(filter));
const narrowed = computed(() => filter.elementIds.length + (filter.from ? 1 : 0) + (filter.to ? 1 : 0) + (filter.lucidOnly ? 1 : 0));
const filterOpen = ref(false);
const clearFilter = () => Object.assign(filter, { elementIds: [], from: "", to: "", lucidOnly: false });
const named = computed(() => (j.elements.data.value ?? []).filter((e) => e.name).sort((a, b) => a.name!.localeCompare(b.name!)));
const toggleEl = (id: string) => { filter.elementIds = filter.elementIds.includes(id) ? filter.elementIds.filter((x) => x !== id) : [...filter.elementIds, id]; };
// what a search covered: the device's own journal, or (no copy on this device) what the server sent, opened here
const searchNote = computed(() => {
  if (!active.value) return "";
  if (onDevice()) return "Searched on this device.";
  if ((j.dreams.data.value?.length ?? 0) >= DREAM_LIMIT) return `Searched on this device, in your newest ${DREAM_LIMIT} dreams. Older ones aren't searched here.`;
  return "Searched on this device, in what your server sent.";
});

const empty = computed(() => !groups.value.length);
const fab = computed(() => isPhone.value && !mode.value && !empty.value);
const todayLogged = computed(() => !!nightOfDate(j.nights.data.value ?? [], today));

// the calendar
const month = ref(today.slice(0, 7)), sel = ref(today);
const marks = computed(() => dayMarks(shown.value));
const dayGroups = computed(() => shown.value.filter((g) => g.night.date === sel.value));
const pick = (d: string) => { sel.value = d; if (d.slice(0, 7) !== month.value) month.value = d.slice(0, 7); };

// reading and writing
const mode = computed(() => (route.name === "journal-write" ? "write" : route.name === "journal-dream" ? "read" : null));
const id = computed(() => String(route.params.id ?? ""));
const date = computed(() => (typeof route.query.date === "string" ? route.query.date : undefined));
function write(d?: string) { router.push({ name: "journal-write", params: { id: uuidv7() }, query: { new: "1", ...(d ? { date: d } : {}) } }); }
const fresh = computed(() => route.query.new === "1");
const open = (did: string) => (mode.value ? router.replace : router.push)({ name: "journal-dream", params: { id: did } });
function closeWrite() {
  // a dream that was saved opens to read; one left empty was never made
  if (saveState[id.value] || j.dreams.data.value?.some((x) => x.id === id.value)) router.replace({ name: "journal-dream", params: { id: id.value } });
  else if (history.state?.back) router.back(); else router.replace("/journal");
}
const closeRead = () => (history.state?.back ? router.back() : router.replace("/journal"));

async function noRecall(d: string) { try { await markNoRecall(d); } catch (e) { toastError(e); } }
const menu = computed(() => [
  { label: "No recall last night", icon: "moon", run: () => noRecall(today), hidden: todayLogged.value },
  { label: "Write a dream", icon: "plus", run: () => write(), hidden: !mode.value || isPhone.value },
  { label: "Search filters", icon: "filter", run: () => (filterOpen.value = true), hidden: empty.value },
]);
</script>

<template>
  <div class="page" :class="{ jfab: fab }">
    <template v-if="isPhone && mode">
      <DreamEditor v-if="mode === 'write'" :id="id" :key="id" :date="date" :fresh="fresh" full @close="closeWrite" />
      <DreamView v-else :id="id" :key="'r' + id" back @edit="router.push({ name: 'journal-write', params: { id } })" @close="closeRead" />
    </template>
    <div v-else class="jcols" :class="{ split: !isPhone }">
      <div class="jlist">
        <div class="ph">
          <div><h1>Journal</h1></div>
          <div class="acts">
            <div v-if="!empty" class="seg"><button :class="{ on: view === 'list' }" @click="setView('list')">List</button><button :class="{ on: view === 'calendar' }" @click="setView('calendar')">Calendar</button></div>
            <Menu :items="menu" />
            <!-- with a dream open beside the list, its Edit or Done is the one primary button; this moves to the menu -->
            <button v-if="!empty && !isPhone && !mode" class="btn" @click="write()"><Icon name="plus" :size="16" />Write a dream</button>
          </div>
        </div>

        <div v-if="empty" class="card empty">
          <Icon name="book" :size="34" /><b>No dreams yet</b>Write down what you remember as soon as you wake. A fragment counts.
          <!-- the editor beside it has the screen's one primary button while it is open -->
          <div v-if="mode !== 'write'"><button class="btn" @click="write()">Write a dream</button></div>
          <div v-if="!todayLogged"><button class="qb" @click="noRecall(today)">No recall last night</button></div>
        </div>
        <template v-else>
          <div v-if="unsent.ids.length" class="card tiny jnote"><Icon name="lock" :size="14" />{{ unsent.ids.length === 1 ? "1 dream is" : `${unsent.ids.length} dreams are` }} kept sealed on this device until the server can take {{ unsent.ids.length === 1 ? "it" : "them" }}.</div>
          <div v-if="!todayLogged" class="card jtoday"><div class="row"><Icon name="moon" :size="18" /><div class="grow"><div class="t">Last night</div><div class="tiny">Nothing written yet</div></div><button class="qb acc" @click="noRecall(today)">No recall</button></div></div>

          <template v-if="view === 'list'">
            <div class="jsearch">
              <div class="search grow"><Icon name="search" :size="18" /><input v-model="filter.text" type="search" placeholder="Search your dreams" aria-label="Search your dreams" /></div>
              <button class="ib sm" :class="{ on: narrowed }" aria-label="Search filters" @click="filterOpen = true"><Icon name="filter" :size="18" /></button>
            </div>
            <div v-if="searchNote" class="tiny jmut">{{ searchNote }}<template v-if="narrowed"> · <button class="lnk" @click="clearFilter">Clear filters</button></template></div>
            <div v-if="active && !shown.length" class="card empty sm">Nothing matches.</div>
            <NightList :groups="shown" :counts="counts" :selected="mode ? id : undefined" @open="open" />
          </template>
          <template v-else>
            <JournalCalendar v-model:month="month" :marks="marks" :selected="sel" @pick="pick" />
            <div class="sh"><h2>{{ fmt.date(sel, { weekday: "long", day: "numeric", month: "long" }) }}</h2>
              <span v-if="sel <= today" class="row"><button v-if="!nightOfDate(j.nights.data.value ?? [], sel)" class="lnk" @click="noRecall(sel)">No recall</button><button class="lnk" @click="write(sel)"><Icon name="plus" :size="14" />Dream</button></span>
            </div>
            <div v-if="!dayGroups.length" class="card empty sm">Nothing written for this night.</div>
            <NightList :groups="dayGroups" :counts="counts" :selected="mode ? id : undefined" bare @open="open" />
          </template>
        </template>
      </div>
      <aside v-if="!isPhone" class="jside">
        <div class="card">
          <DreamEditor v-if="mode === 'write'" :id="id" :key="id" :date="date" :fresh="fresh" @close="closeWrite" />
          <DreamView v-else-if="mode === 'read'" :id="id" :key="'r' + id" @edit="router.push({ name: 'journal-write', params: { id } })" @close="closeRead" />
          <div v-else class="empty sm">Pick a dream to read it here.</div>
        </div>
      </aside>
    </div>
    <!-- on the body, as in Motus's shell: inside the page, a transform from the page transition would make the page,
         not the screen, what it is fixed to, and it would float over the list -->
    <Teleport to="body"><button v-if="fab" class="fab" aria-label="Write a dream" @click="write()"><Icon name="plus" :size="26" /></button></Teleport>

    <Sheet v-if="filterOpen" title="Search filters" @close="filterOpen = false">
      <label class="tgl"><div class="grow"><div class="t">Lucid dreams only</div></div><span class="tg"><input v-model="filter.lucidOnly" type="checkbox" /></span></label>
      <div class="g2 jg">
        <div class="fld"><label>From</label><DatePicker v-model="filter.from" :max="filter.to || today" clearable /></div>
        <div class="fld"><label>To</label><DatePicker v-model="filter.to" :min="filter.from || undefined" :max="today" clearable /></div>
      </div>
      <div class="fld"><label>Elements</label>
        <div v-if="named.length" class="chips"><button v-for="e in named" :key="e.id" class="fchip" :class="{ on: filter.elementIds.includes(e.id) }" @click="toggleEl(e.id)">{{ e.name }}</button></div>
        <div v-else class="tiny jmut">Elements you add to dreams show here.</div>
      </div>
      <template #foot><button class="btn o" :disabled="!narrowed" @click="clearFilter">Clear</button><button class="btn" @click="filterOpen = false">Show</button></template>
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
.jmut { color: var(--tx2); }
.lnk { background: none; border: 0; color: var(--acc); cursor: pointer; font-family: inherit; font-size: 12.5px; font-weight: 600; padding: 0; display: inline-flex; align-items: center; gap: 2px; }
.sh .row { gap: var(--hg); }
.jg { gap: var(--hg); }
.ph .acts { flex-wrap: wrap; justify-content: flex-end; }
/* the last row scrolls clear of the + button (58px tall, sitting above the tab bar) */
.jfab { padding-bottom: calc(58px + var(--spg)); }
</style>
