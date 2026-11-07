<script setup lang="ts">
// Backup & restore (PLAN.md §12, LDJ-35): automatic backups (how often, how many to keep, where), a backup now with an
// optional passphrase, and restoring one by merge or replace. What a backup holds, and what it doesn't hide, is said
// plainly on this screen.
import { useFmt } from "../../core/format";
import { computed, ref } from "vue";
import { useSettings, saveSettings } from "../../api/queries";
import { backupNow, backupLog, canPickFolder, pickFolder, folderName, restoreFromFile } from "../../core/backup";
import { prompt } from "../../core/ask";
import { toast, toastError } from "../../core/toast";
import { holdForDialog } from "../../core/lock";
import AppSelect from "../AppSelect.vue";

const s = useSettings();
const fmt = useFmt();
const log = ref(backupLog());
const folder = ref<string | null>(null);
const N = (globalThis as any).somniumNative;
if (N?.backupFolder) N.backupFolder().then((n: string) => (folder.value = n)); else folderName().then((n) => (folder.value = n));
const busy = ref(false);
const set = (patch: Record<string, unknown>) => saveSettings({ backup: patch });
// where automatic backups go, said as it is: a browser without the File System Access API can't write files itself
const automatic = computed(() => !!N?.saveBackup || !!folder.value);
const whereText = computed(() => {
  if (N?.saveBackup) return `Folder: ${folder.value ?? "…"}`;
  if (folder.value) return `Folder: ${folder.value} · written while Somnium is open`;
  if (canPickFolder()) return "Pick a folder and backups are written there automatically while Somnium is open";
  return "This browser can't save files on its own, so it can't back up automatically. When one is due you're reminded to download it.";
});
const size = (n: number | null) => (n == null ? "" : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

async function now() {
  busy.value = true;
  try {
    let pass: string | undefined;
    if (s.value.backup.passphrase) {
      const p = await prompt("Backup passphrase", { text: "This hides the dates and ratings too. You'll need it, and your password or recovery key, to restore.", secret: true, autocomplete: "new-password" });
      if (!p) return;
      pass = p;
    }
    const n = await backupNow({ passphrase: pass, keep: s.value.backup.keep });
    log.value = backupLog(); toast(`Saved ${n}`);
  } catch (e) { log.value = backupLog(); toastError(e); } finally { busy.value = false; }
}
async function chooseFolder() {
  holdForDialog(); // the folder dialog takes focus from the window, and this page is waiting for its answer
  try { const f = N?.chooseBackupFolder ? await N.chooseBackupFolder() : await pickFolder(); if (f) { folder.value = f; toast("Backups will be saved there"); } } catch { /* cancelled */ }
}
async function restore(ev: Event) {
  const file = (ev.target as HTMLInputElement).files?.[0]; (ev.target as HTMLInputElement).value = "";
  if (!file) return;
  try { await restoreFromFile(file, { date: (d) => fmt.value.date(d) }); } catch (e) { toastError(e); }
}
</script>

<template>
  <div class="stack">
    <div class="card">
      <label class="tgl"><div class="grow"><div class="t">Automatic backups</div><div class="s">A copy of your journal saved on this device, sealed like on the server</div></div><span class="tg"><input type="checkbox" :checked="s.backup.on" @change="set({ on: ($event.target as HTMLInputElement).checked })" /></span></label>
      <template v-if="s.backup.on">
        <div class="li"><div class="grow"><div class="t">How often</div></div><AppSelect :model-value="s.backup.every" :options="[{ value: 'daily', label: 'Every day' }, { value: 'weekly', label: 'Every week' }]" title="How often" style="width:auto" @update:model-value="(v) => set({ every: v })" /></div>
        <div class="li"><div class="grow"><div class="t">Keep</div><div class="s">Older backups are removed, the newest always stays</div></div><AppSelect :model-value="s.backup.keep" :options="[3, 7, 14, 30, 60].map((n) => ({ value: n, label: `The last ${n}` }))" title="Keep" style="width:auto" @update:model-value="(v) => set({ keep: v })" /></div>
        <div class="li"><div class="grow"><div class="t">Where</div><div class="s" :class="{ neg: !automatic && !canPickFolder() }">{{ whereText }}</div></div>
          <button v-if="canPickFolder() || N?.chooseBackupFolder" class="qb acc" @click="chooseFolder">{{ folder ? "Change" : "Pick folder" }}</button>
          <button v-if="N?.openBackupFolder" class="qb" @click="N.openBackupFolder()">Open</button></div>
      </template>
      <label class="tgl"><div class="grow"><div class="t">Extra passphrase</div><div class="s">Asked for each backup you make by hand; automatic ones can't ask, so they don't use it</div></div><span class="tg"><input type="checkbox" :checked="s.backup.passphrase" @change="set({ passphrase: ($event.target as HTMLInputElement).checked })" /></span></label>
      <div class="li"><div class="grow"><div class="t">Last backup</div><div class="s">{{ log.lastAt ? [`${fmt.date(log.lastAt)} ${fmt.time(log.lastAt)}`, size(log.size), log.where].filter(Boolean).join(" · ") : "None yet" }}<span v-if="log.error" class="neg"> · {{ log.error }}</span></div></div><button class="btn s" :disabled="busy" @click="now">{{ automatic ? "Back up now" : "Download one now" }}</button></div>
    </div>
    <p class="tiny">What a backup holds: your dreams, notes and every other written word stay sealed with your account's key, exactly as the server keeps them, so the file opens only with your password (the one you had when it was made) or your recovery key. The dates, times and ratings are not sealed and can be read by anyone who has the file. Turn on the extra passphrase to hide those too.</p>
    <div class="card">
      <div class="li"><div class="grow"><div class="t">Restore</div><div class="s">From a .somniumbackup file or a Somnium JSON export. You see what it holds, then choose to merge or replace.</div></div><label class="btn o s" style="cursor:pointer">Choose file<input type="file" accept=".somniumbackup,.json,application/json" hidden @change="restore" /></label></div>
    </div>
    <p class="tiny">Merge adds what's missing and keeps the newest version of each entry. Replace makes the journal exactly like the backup; your account, password and recovery key stay as they are. A local account can be moved to a server by restoring its backup into the server account (Merge).</p>
  </div>
</template>
