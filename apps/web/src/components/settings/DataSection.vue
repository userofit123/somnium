<script setup lang="ts">
// Export & import (PLAN.md §12, LDJ-36). Every file is built on this device from the opened journal: JSON (everything),
// Markdown (a zip with one file per dream, or one long file) and CSV (dreams, nights, reality checks; the words only
// when asked). The import is ImportFlow, shared with the Journal's import sheet (LDJ-129).
import { ref } from "vue";
import { api } from "../../api/client";
import { download, tellLeftOut } from "../../core/backup";
import { toastError } from "../../core/toast";
import { choose, confirm } from "../../core/ask";
import { exportCsv, journalMarkdown, dreamMarkdownFiles, makeZip } from "@somnium/shared";
import ImportFlow from "./ImportFlow.vue";

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

    <ImportFlow />
  </div>
</template>
