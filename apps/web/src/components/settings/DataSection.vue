<script setup lang="ts">
// Export & import (PLAN.md §12, LDJ-36). Every file is built on this device from the opened journal: JSON (everything),
// Markdown (a zip with one file per dream, or one long file) and CSV (dreams, nights, reality checks; the words only
// when asked). Imports: Somnium backups and exports (core/backup.ts), Markdown or text journals split at their date
// headings, and CSV with a column mapping. Each proposed entry is reviewed first, then saved through the normal routes,
// so it is sealed on the way in. No other app documents its export's layout (docs/import-export.md), so there is no
// app-specific reader: their Markdown, text and CSV files go through these same paths.
import { computed, ref } from "vue";
import { api } from "../../api/client";
import { invalidate } from "../../api/live";
import { download, restoreFromFile, tellLeftOut } from "../../core/backup";
import { toast, toastError } from "../../core/toast";
import { choose, confirm } from "../../core/ask";
import { useFmt } from "../../core/format";
import { entriesFromCsv, exportCsv, guessCsvMapping, journalMarkdown, dreamMarkdownFiles, makeZip, parseCsv, splitJournalText, type CsvMapping, type ImportedEntry } from "@somnium/shared";
import AppSelect from "../AppSelect.vue";

const fmt = useFmt();
const today = () => new Date().toISOString().slice(0, 10);
const busy = ref(false);
const withText = ref(false);

async function opened(): Promise<any> { const d = await api.get("/export"); tellLeftOut(d); return d; }
async function run(fn: () => Promise<void>) { if (busy.value) return; busy.value = true; try { await fn(); } catch (e) { toastError(e); } finally { busy.value = false; } }

const exportJson = () => run(async () => {
  if (!(await confirm("Export everything as JSON?", { text: "The file is not encrypted: anyone who opens it can read your whole journal. For a copy to keep, a backup is safer.", ok: "Export" }))) return;
  download(new Blob([JSON.stringify(await opened(), null, 2)], { type: "application/json" }), `somnium-export-${today()}.json`);
});
const exportMarkdown = () => run(async () => {
  const how = await choose("Export dreams as Markdown", [{ label: "One file per dream (a .zip)", value: "zip" }, { label: "One long file", value: "one" }], "Not encrypted: anyone who opens the files can read them.");
  if (!how) return;
  const { tables } = await opened();
  if (how === "one") return download(new Blob([journalMarkdown(tables)], { type: "text/markdown" }), `somnium-dreams-${today()}.md`);
  const files = dreamMarkdownFiles(tables);
  download(new Blob([makeZip(files.map((f) => ({ name: f.filename, data: f.markdown })))], { type: "application/zip" }), `somnium-dreams-${today()}.zip`);
});
const exportCsvs = () => run(async () => {
  if (withText.value && !(await confirm("Include the dream text?", { text: "The CSV files are not encrypted, so the text will be readable by anyone who opens them.", ok: "Export" }))) return;
  const { tables } = await opened();
  const bom = "﻿"; // so spreadsheet apps read the file as UTF-8
  download(new Blob([makeZip([
    { name: "dreams.csv", data: bom + exportCsv(tables, "dreams", withText.value) },
    { name: "nights.csv", data: bom + exportCsv(tables, "nights", withText.value) },
    { name: "reality-checks.csv", data: bom + exportCsv(tables, "reality_checks", withText.value) },
  ])], { type: "application/zip" }), `somnium-csv-${today()}.zip`);
});

// ----- import -----
async function importBackup(ev: Event) {
  const f = (ev.target as HTMLInputElement).files?.[0]; (ev.target as HTMLInputElement).value = ""; if (!f) return;
  try { await restoreFromFile(f, { date: (d) => fmt.value.date(d) }); } catch (e) { toastError(e); }
}

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
const saveReview = () => run(async () => {
  const list = kept.value;
  const nights = new Map<string, string>();
  let n = 0;
  for (const e of list) {
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
});
</script>

<template>
  <div class="stack">
    <div class="sh first"><h2>Export</h2></div>
    <div class="card">
      <div class="li"><div class="grow"><div class="t">Everything (JSON)</div><div class="s">Your whole journal and settings, readable · not encrypted</div></div><button class="btn o s" :disabled="busy" @click="exportJson">Download</button></div>
      <div class="li"><div class="grow"><div class="t">Dreams (Markdown)</div><div class="s">One file per dream in a .zip, or one long file</div></div><button class="btn o s" :disabled="busy" @click="exportMarkdown">Download</button></div>
      <div class="li"><div class="grow"><div class="t">Spreadsheet (CSV)</div><div class="s">Dreams, nights and reality checks in a .zip</div></div><button class="btn o s" :disabled="busy" @click="exportCsvs">Download</button></div>
      <label class="tgl"><div class="grow"><div class="t">Include dream text in CSV</div><div class="s">Titles, text and notes; off, the files hold only dates, marks and ratings</div></div><span class="tg"><input v-model="withText" type="checkbox" /></span></label>
    </div>
    <p class="tiny">Exports are made on this device and are not encrypted. For a copy to keep safe, use Backup.</p>

    <div class="sh"><h2>Import</h2></div>
    <div class="card">
      <div class="li"><div class="grow"><div class="t">Somnium backup or export</div><div class="s">.somniumbackup or .json · merge or replace</div></div><label class="btn o s" style="cursor:pointer">Choose<input type="file" accept=".somniumbackup,.json,application/json" hidden @change="importBackup" /></label></div>
      <div class="li"><div class="grow"><div class="t">Markdown or text</div><div class="s">A journal split at its date headings, or one note per dream with the date in its name</div></div><label class="btn o s" style="cursor:pointer">Choose<input type="file" accept=".md,.markdown,.txt,text/plain,text/markdown" multiple hidden @change="importText" /></label></div>
      <div class="li"><div class="grow"><div class="t">CSV</div><div class="s">You choose which column is the date, title and text</div></div><label class="btn o s" style="cursor:pointer">Choose<input type="file" accept=".csv,.tsv,text/csv" hidden @change="importCsv" /></label></div>
    </div>
    <p class="tiny">From other apps: Oniri's TXT and CSV exports, Markdown notes (Obsidian, dreamy) and any other app's text or CSV files go through Markdown or text and CSV above. No journal app documents the layout of its export, so Somnium has no reader made for one app. Lucidity's PDF book can't be read.</p>

    <template v-if="csv">
      <div class="sh"><h2>Columns</h2></div>
      <div class="card">
        <div class="li"><div class="grow t">Date</div><AppSelect v-model="csv.map.date" :options="columns" title="Date" style="width:auto" /></div>
        <div class="li"><div class="grow t">Title</div><AppSelect :model-value="csv.map.title ?? -1" :options="optional" title="Title" style="width:auto" @update:model-value="(v) => (csv!.map.title = v)" /></div>
        <div class="li"><div class="grow t">Dream text</div><AppSelect v-model="csv.map.text" :options="columns" title="Dream text" style="width:auto" /></div>
        <div class="li"><div class="grow t">Lucid (yes or no)</div><AppSelect :model-value="csv.map.lucid ?? -1" :options="optional" title="Lucid" style="width:auto" @update:model-value="(v) => (csv!.map.lucid = v)" /></div>
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
  </div>
</template>
