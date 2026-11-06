<script setup lang="ts">
// Backup & restore (requirement 20): automatic backups on or off, how often, how many to keep, where, encrypted or not;
// a backup now; and restoring one (replacing everything, or merging in what's missing).
import { useFmt } from "../../core/format";
import { ref } from "vue";
import { useSettings, saveSettings } from "../../api/queries";
import { api } from "../../api/client";
import { invalidate } from "../../api/live";
import { backupNow, backupLog, readBackup, canPickFolder, pickFolder, folderName } from "../../core/backup";
import { prompt, choose, confirm } from "../../core/ask";
import { toast, toastError } from "../../core/toast";
import { native } from "../../core/device";
import AppSelect from "../AppSelect.vue";

const s = useSettings();
const log = ref(backupLog());
const folder = ref<string | null>(null);
const N = (globalThis as any).somniumNative;
if (N?.backupFolder) N.backupFolder().then((n: string) => (folder.value = n)); else folderName().then((n) => (folder.value = n));
const busy = ref(false);
const set = (patch: Record<string, unknown>) => saveSettings({ backup: patch });
async function now() {
  busy.value = true;
  try {
    const pw = s.value.backup.encrypt ? await prompt("Backup password", { text: "You'll need it to restore this backup." }) : undefined;
    if (s.value.backup.encrypt && !pw) return;
    const n = await backupNow({ password: pw ?? undefined, keep: s.value.backup.keep });
    log.value = backupLog(); toast(`Saved ${n}`);
  } catch (e) { toastError(e); } finally { busy.value = false; }
}
async function choose_folder() {
  try { const f = N?.chooseBackupFolder ? await N.chooseBackupFolder() : await pickFolder(); if (f) { folder.value = f; toast("Backups will be saved there"); } } catch { /* cancelled */ }
}
async function restore(ev: Event) {
  const file = (ev.target as HTMLInputElement).files?.[0]; (ev.target as HTMLInputElement).value = "";
  if (!file) return;
  try {
    const data = await readBackup(file, () => prompt("This backup is encrypted", { text: "Enter its password." }));
    const pv = await api.post("/import/preview", { data });
    const mode = await choose(`Restore backup from ${`${fmt.value.date(pv.exportedAt)} ${fmt.value.time(pv.exportedAt)}`}?`, [
      { label: "Merge: add what's missing, keep everything you have", value: "merge" },
      { label: "Replace: make Somnium exactly like the backup", value: "replace" },
    ], Object.entries(pv.counts as Record<string, number>).map(([t, n]) => `${n} ${t.replace(/_/g, " ")}`).join(", ") || "Settings only.");
    if (!mode) return;
    if (mode === "replace") {
      if (!(await confirm("Replace everything?", { text: "A backup of what you have now is downloaded first.", ok: "Replace", danger: true }))) return;
      await backupNow({ interactive: true });
    }
    await api.post("/import", { data, mode });
    invalidate(["*"]); toast("Restored");
  } catch (e) { toastError(e); }
}
const fmt = useFmt();
</script>

<template>
  <div class="stack">
    <div class="card">
      <label class="tgl"><div class="grow"><div class="t">Automatic backups</div><div class="s">A copy of everything, saved on this device</div></div><span class="tg"><input type="checkbox" :checked="s.backup.on" @change="set({ on: ($event.target as HTMLInputElement).checked })" /></span></label>
      <template v-if="s.backup.on">
        <div class="li"><div class="grow"><div class="t">How often</div></div><AppSelect :model-value="s.backup.every" :options="[{ value: 'daily', label: 'Every day' }, { value: 'weekly', label: 'Every week' }]" title="How often" style="width:auto" @update:model-value="(v) => set({ every: v })" /></div>
        <div class="li"><div class="grow"><div class="t">Keep</div><div class="s">Older backups are removed, the newest always stays</div></div><AppSelect :model-value="s.backup.keep" :options="[3, 7, 14, 30, 60].map((n) => ({ value: n, label: `The last ${n}` }))" title="Keep" style="width:auto" @update:model-value="(v) => set({ keep: v })" /></div>
        <div class="li"><div class="grow"><div class="t">Where</div><div class="s">{{ folder ? `Folder: ${folder}` : canPickFolder() ? "Pick a folder and backups are written there automatically" : "This browser can't write to a folder. Your data is kept on the server; use Back up now for a copy of your own" }}</div></div>
          <button v-if="canPickFolder() || N?.chooseBackupFolder" class="qb acc" @click="choose_folder">{{ folder ? "Change" : "Pick folder" }}</button>
          <button v-if="N?.openBackupFolder" class="qb" @click="N.openBackupFolder()">Open</button></div>
        <label class="tgl"><div class="grow"><div class="t">Encrypt with a password</div><div class="s">Asked each time a backup is made</div></div><span class="tg"><input type="checkbox" :checked="s.backup.encrypt" @change="set({ encrypt: ($event.target as HTMLInputElement).checked })" /></span></label>
      </template>
      <div class="li"><div class="grow"><div class="t">Last backup</div><div class="s">{{ log.lastAt ? `${`${fmt.date(log.lastAt)} ${fmt.time(log.lastAt)}`} · ${log.lastName}` : "None yet" }}<span v-if="log.error" class="neg"> · {{ log.error }}</span></div></div><button class="btn s" :disabled="busy" @click="now">Back up now</button></div>
    </div>
    <div class="card">
      <div class="li"><div class="grow"><div class="t">Restore</div><div class="s">From a .somniumbackup file or a Somnium JSON export. You choose to merge or replace.</div></div><label class="btn o s" style="cursor:pointer">Choose file<input type="file" accept=".somniumbackup,.json" hidden @change="restore" /></label></div>
    </div>
    <p class="tiny">A local account can be moved to a server by restoring its backup into the server account (Merge).</p>
  </div>
</template>
