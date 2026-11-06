<script setup lang="ts">
// Export & import (PLAN.md §12): everything as JSON, and importing a Somnium export (merge or replace).
import { api } from "../../api/client";
import { invalidate } from "../../api/live";
import { download } from "../../core/backup";
import { toast, toastError } from "../../core/toast";
import { choose } from "../../core/ask";

async function exportJson() { const d = await api.get("/export"); download(new Blob([JSON.stringify(d, null, 2)], { type: "application/json" }), `somnium-export-${new Date().toISOString().slice(0, 10)}.json`); }
async function importJson(ev: Event) {
  const f = (ev.target as HTMLInputElement).files?.[0]; (ev.target as HTMLInputElement).value = ""; if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    const mode = await choose("Import this export?", [{ label: "Merge: add what's missing", value: "merge" }, { label: "Replace everything", value: "replace" }]);
    if (!mode) return;
    await api.post("/import", { data, mode }); invalidate(["*"]); toast("Imported");
  } catch (e) { toastError(e); }
}
</script>

<template>
  <div class="stack">
    <div class="sh first"><h2>Export</h2></div>
    <div class="card">
      <div class="li"><div class="grow"><div class="t">Everything (JSON)</div><div class="s">Your settings and, as they come, your dreams, signs and practice</div></div><button class="btn o s" @click="exportJson">Download</button></div>
    </div>
    <div class="sh"><h2>Import</h2></div>
    <div class="card">
      <div class="li"><div class="grow"><div class="t">Somnium export</div><div class="s">.json</div></div><label class="btn o s" style="cursor:pointer">Choose<input type="file" accept=".json" hidden @change="importJson" /></label></div>
    </div>
  </div>
</template>
