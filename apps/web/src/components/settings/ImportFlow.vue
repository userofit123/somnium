<script setup lang="ts">
// Import from other journals (PLAN.md §12, LDJ-36): Markdown or text journals split at their date headings, and CSV
// with a column mapping. Each proposed entry is reviewed first, then saved through the normal routes, so it is sealed
// on the way in. No other app documents its export's layout (docs/import-export.md), so there is no app-specific
// reader: their Markdown, text and CSV files go through these same paths. One flow for Settings → Data and the
// Journal's import sheet (LDJ-129); `done` fires once entries are saved, so the sheet can close back to the list.
import { computed, ref } from "vue";
import { api } from "../../api/client";
import { invalidate } from "../../api/live";
import { toast, toastError } from "../../core/toast";
import { useFmt } from "../../core/format";
import { entriesFromCsv, guessCsvMapping, parseCsv, splitJournalText, type CsvMapping, type ImportedEntry } from "@somnium/shared";
import AppSelect from "../AppSelect.vue";

// first: no section heading above it (the Journal's sheet has its own title)
defineProps<{ first?: boolean }>();
const emit = defineEmits<{ done: [] }>();
const fmt = useFmt();
const busy = ref(false);

// the review: entries proposed from a file, each ticked to be saved
const review = ref<{ entries: (ImportedEntry & { keep: boolean })[]; note: string } | null>(null);
const csv = ref<{ rows: string[][]; map: CsvMapping } | null>(null);
const show = (entries: ImportedEntry[], note: string) => {
  if (!entries.length) { toast("No dated entries found in that file"); return; }
  review.value = { entries: entries.map((e) => ({ ...e, keep: true })), note };
};
async function importText(ev: Event) {
  const files = [...((ev.target as HTMLInputElement).files ?? [])]; (ev.target as HTMLInputElement).value = ""; if (!files.length) return;
  try {
    const all: ImportedEntry[] = []; let undated = 0;
    for (const f of files) { const r = splitJournalText(await f.text(), f.name); all.push(...r.entries); undated += r.undated; }
    csv.value = null;
    show(all, undated ? `${undated} characters before the first date are left out.` : "");
  } catch (e) { toastError(e); }
}
async function importCsv(ev: Event) {
  const f = (ev.target as HTMLInputElement).files?.[0]; (ev.target as HTMLInputElement).value = ""; if (!f) return;
  try {
    const rows = parseCsv(await f.text());
    if (rows.length < 2) { toast("That file has no rows"); return; }
    review.value = null;
    csv.value = { rows, map: guessCsvMapping(rows[0]!) };
  } catch (e) { toastError(e); }
}
const columns = computed(() => (csv.value?.rows[0] ?? []).map((h, i) => ({ value: i, label: h || `Column ${i + 1}` })));
const optional = computed(() => [{ value: -1, label: "None" }, ...columns.value]);
function mapCsv() {
  if (!csv.value) return;
  const m = csv.value.map;
  const { entries, skipped } = entriesFromCsv(csv.value.rows, { ...m, title: m.title === -1 ? undefined : m.title, lucid: m.lucid === -1 ? undefined : m.lucid });
  show(entries, skipped ? `${skipped} row${skipped === 1 ? "" : "s"} without a date or text are left out.` : "");
}
const kept = computed(() => review.value?.entries.filter((e) => e.keep) ?? []);
const preview = (e: ImportedEntry) => (e.title ? e.title + " · " : "") + e.text.replace(/\s+/g, " ").slice(0, 90);

/** Saves the ticked entries: each into the night of its date (made when missing), through the sealing transport. */
async function saveReview() {
  if (busy.value) return;
  busy.value = true;
  try {
    const nights = new Map<string, string>();
    let n = 0;
    for (const e of kept.value) {
      let night = nights.get(e.date);
      if (!night) {
        const found = (await api.get<{ id: string; nap: boolean }[]>("/nights", { from: e.date, to: e.date })).find((x) => !x.nap);
        night = found?.id ?? (await api.post<{ id: string }>("/nights", { date: e.date })).id;
        nights.set(e.date, night);
      }
      await api.post("/dreams", { nightId: night, title: e.title || null, text: e.text || null, lucid: !!e.lucid, lucidityLevel: e.lucid ? 1 : 0 });
      n++;
    }
    invalidate(["*"]);
    review.value = null; csv.value = null;
    toast(`Imported ${n} dream${n === 1 ? "" : "s"}`);
    emit("done");
  } catch (e) { toastError(e); } finally { busy.value = false; }
}
</script>

<template>
  <div class="sh" :class="{ first }"><h2>Import from other journals</h2></div>
  <div class="card">
    <div class="li"><div class="grow"><div class="t">Markdown or text</div><div class="s">A journal split at its date headings, or one note per dream with the date in its name</div></div><label class="btn o s clk">Choose<input type="file" accept=".md,.markdown,.txt,text/plain,text/markdown" multiple hidden @change="importText" /></label></div>
    <div class="li"><div class="grow"><div class="t">CSV</div><div class="s">You choose which column is the date, title and text</div></div><label class="btn o s clk">Choose<input type="file" accept=".csv,.tsv,text/csv" hidden @change="importCsv" /></label></div>
  </div>
  <p class="tiny">Restoring a Somnium backup? Go to <router-link to="/settings/backup">Backups</router-link>.</p>
  <p class="tiny">From other apps: Oniri's TXT and CSV exports, Markdown notes (Obsidian, dreamy) and any other app's text or CSV files go through Markdown or text and CSV above. No journal app documents the layout of its export, so Somnium has no reader made for one app. Lucidity's PDF book can't be read.</p>

  <template v-if="csv">
    <div class="sh"><h2>Columns</h2></div>
    <div class="card">
      <div class="li"><div class="grow t">Date</div><AppSelect v-model="csv.map.date" :options="columns" title="Date" class="sel-auto" /></div>
      <div class="li"><div class="grow t">Title</div><AppSelect :model-value="csv.map.title ?? -1" :options="optional" title="Title" class="sel-auto" @update:model-value="(v) => (csv!.map.title = v)" /></div>
      <div class="li"><div class="grow t">Dream text</div><AppSelect v-model="csv.map.text" :options="columns" title="Dream text" class="sel-auto" /></div>
      <div class="li"><div class="grow t">Lucid (yes or no)</div><AppSelect :model-value="csv.map.lucid ?? -1" :options="optional" title="Lucid" class="sel-auto" @update:model-value="(v) => (csv!.map.lucid = v)" /></div>
      <div class="li"><div class="grow s">{{ csv.rows.length - 1 }} rows</div><button class="btn o s" @click="csv = null">Cancel</button><button class="btn s" @click="mapCsv">Next</button></div>
    </div>
  </template>

  <template v-if="review">
    <div class="sh"><h2>Review</h2></div>
    <p v-if="review.note" class="tiny">{{ review.note }}</p>
    <div class="card">
      <label v-for="(e, i) in review.entries" :key="i" class="tgl"><div class="grow"><div class="t">{{ fmt.date(e.date) }}{{ e.lucid ? " · lucid" : "" }}</div><div class="s">{{ preview(e) }}</div></div><span class="tg"><input v-model="e.keep" type="checkbox" /></span></label>
      <div class="li"><div class="grow s">{{ kept.length }} of {{ review.entries.length }} chosen</div><button class="btn o s" @click="review = null">Cancel</button><button class="btn s" :disabled="busy || !kept.length" @click="saveReview">Import {{ kept.length }}</button></div>
    </div>
  </template>
</template>
