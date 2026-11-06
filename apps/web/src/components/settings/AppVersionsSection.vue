<script setup lang="ts">
// App & Versions: the version installed here, whether a newer one exists, the download that fits this device
// (in the apps, the in-app updater instead), the other downloads, and the GitHub repository.
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import { useSettings, saveSettings } from "../../api/queries";
import { session, isLocalAccount } from "../../core/session";
import { updater } from "../../core/updater";
import { useFmt } from "../../core/format";
import { latestRelease, detectPlatform, downloads, newer, REPO, REPO_URL } from "../../core/releases";

const s = useSettings();
const router = useRouter();
const qc = useQueryClient();
const rel = useQuery({ queryKey: ["static", "release"], queryFn: latestRelease, staleTime: 3600_000, refetchOnWindowFocus: false, retry: false });
const checkNow = () => { void rel.refetch(); void qc.invalidateQueries({ queryKey: ["static", "update"] }); };
const f = useFmt();
const set = (patch: Record<string, unknown>) => saveSettings({ updates: patch });

const platform = detectPlatform();
const localAccount = ref(true);
isLocalAccount().then((v) => { localAccount.value = v; });
const webVersion = import.meta.env.VITE_VERSION || session.version;
const installed = computed(() => (platform.app && updater.appVersion) || webVersion || "-");
// a server account also runs the server's version; a local account has no server
const serverVersion = computed(() => (!localAccount.value && session.version && session.version !== installed.value ? session.version : ""));
const latest = computed(() => rel.data.value?.latest ?? null);
const isNewer = computed(() => !!latest.value && installed.value !== "-" && newer(latest.value, installed.value));
// "Checking…" on every check, not only the first: a second check with the same answer would otherwise change nothing on
// screen, and the button would seem not to work
// a ready download of an older version than the newest release is dropped, so Install never installs another version
// than the one shown as available
watch([latest, () => updater.stagedVersion, () => updater.ready], () => {
  if (updater.ready && !updater.downloading && latest.value && updater.stagedVersion && newer(latest.value, updater.stagedVersion)) updater.forget();
}, { immediate: true });
watch(latest, (v) => { updater.latest = v ?? ""; }, { immediate: true });
const checking = computed(() => rel.isFetching.value);
const status = computed(() => (checking.value ? "Checking…" : !latest.value ? rel.data.value?.error ?? "Could not check for updates" : isNewer.value ? `Version ${latest.value} available` : "Up to date"));
const checkedAt = computed(() => (rel.dataUpdatedAt.value ? `Checked at ${f.value.time(new Date(rel.dataUpdatedAt.value).toISOString())}` : ""));
// how a browser (or the installed web app) gets a new version: it loads whatever its server runs, so the server is updated
const isAdmin = computed(() => session.user?.role === "admin");
const webHow = computed(() => (isAdmin.value
  ? `Update your server to it (Docker image ghcr.io/${REPO}:${latest.value}), then reload this page.`
  : "This page gets it once the person who runs your server updates it."));

const all = computed(() => downloads(rel.data.value?.assets ?? []));
// the first matching download for this system (Linux: the AppImage, which runs on any distribution)
const mine = computed(() => all.value.find((d) => d.key === platform.key));
const others = computed(() => all.value.filter((d) => d !== mine.value));
const DOWNLOAD_LABEL: Record<string, string> = { android: "Download the APK", windows: "Download for Windows", linux: "Download for Linux", mac: "Download for macOS" };
// In a browser the app made for this device is suggested on a card of its own, as the page's main action: on Android
// always (until there is an APK, the releases page is where it will appear), on a computer only when there is a download.
const RELEASES_URL = `${REPO_URL}/releases`;
const suggest = computed(() => (platform.app ? null : platform.key === "android" ? "android" : ["windows", "linux", "mac"].includes(platform.key) && mine.value ? "desktop" : null));
const showServer = computed(() => session.user?.role === "admin" && !localAccount.value && !!latest.value);
const mb = (n?: number) => (n ? ` · ${Math.max(1, Math.round(n / 1e6))} MB` : "");
</script>

<template>
  <div class="stack">
    <div class="card">
      <div class="li"><div class="grow"><div class="t">Installed version</div><div class="s">{{ installed }} · {{ platform.name }}<template v-if="serverVersion"> · server {{ serverVersion }}</template></div></div><button class="btn o s" :disabled="checking" @click="checkNow">Check now</button></div>
      <div class="li"><div class="grow"><div class="t">{{ status }}</div>
        <template v-if="!checking">
        <div v-if="platform.app && updater.status" class="s">{{ updater.status }}</div>
        <div v-else-if="isNewer && !platform.app" class="s">{{ webHow }}</div>
        <div v-else-if="platform.key === 'ios'" class="s">There is no iPhone or iPad app yet. Somnium works in Safari: tap Share, then Add to Home Screen.</div>
        <div v-else-if="checkedAt" class="s">{{ checkedAt }}</div>
        <div v-if="platform.app && updater.progress !== null" class="pbar" :style="{ marginTop: 'var(--lpy)' }"><i :style="{ width: Math.round(updater.progress * 100) + '%' }"></i></div>
        </template></div>
        <button v-if="platform.app && (updater.ready || (isNewer && !checking))" class="btn s" :disabled="updater.downloading" @click="updater.install()">{{ updater.ready ? (updater.stagedVersion ? `Install ${updater.stagedVersion}` : "Install") : "Download update" }}</button>
</div>
    </div>
    <div v-if="suggest === 'android'" class="card">
      <div class="li"><div class="grow"><div class="t">Get the Android app</div>
        <div class="s">It can keep your data on the phone alone, without a server, and works without a connection. The rest timer rings and shows on the lock screen while the phone is locked, walks and runs are recorded with GPS and counted in steps with the screen off, and it updates itself.</div></div>
        <a v-if="mine" class="btn s" :href="mine.url" target="_blank" rel="noopener">{{ DOWNLOAD_LABEL.android }}</a>
        <a v-else class="btn s" :href="RELEASES_URL" target="_blank" rel="noopener">See releases</a></div>
    </div>
    <div v-else-if="suggest === 'desktop' && mine" class="card">
      <div class="li"><div class="grow"><div class="t">Get the desktop app</div>
        <div class="s">Somnium in its own window. It can keep your data on this computer alone, without a server, works without a connection and updates itself.</div></div>
        <a class="btn s" :href="mine.url" target="_blank" rel="noopener">{{ DOWNLOAD_LABEL[mine.key] }}</a></div>
    </div>
    <div v-if="others.length || showServer" class="card">
      <div class="lbl hgap">Other devices</div>
      <div v-for="d in others" :key="d.name" class="li"><div class="grow"><div class="t">{{ d.label }}</div><div class="s">{{ d.name }}{{ mb(d.size) }}</div></div><a class="btn o s" :href="d.url" target="_blank" rel="noopener">Download</a></div>
      <div v-if="showServer" class="li"><div class="grow"><div class="t">Self-hosted server</div><div class="s">Docker image ghcr.io/{{ REPO }}:{{ latest }}</div></div><a class="btn o s" :href="`${REPO_URL}/pkgs/container/somnium`" target="_blank" rel="noopener">View</a></div>
    </div>
    <div v-if="platform.app" class="card">
      <label class="tgl"><div class="grow"><div class="t">Check for updates automatically</div><div class="s">When the app opens and every few hours. When off, only Check now looks.</div></div><span class="tg"><input type="checkbox" :checked="s.updates.autoCheck" @change="set({ autoCheck: ($event.target as HTMLInputElement).checked })" /></span></label>
      <!-- these two only act on what an automatic check finds, so they show only while it is on -->
      <label v-if="s.updates.autoCheck" class="tgl"><div class="grow"><div class="t">Download updates automatically</div><div class="s">Then install with one tap (Android asks you to confirm every install)</div></div><span class="tg"><input type="checkbox" :checked="s.updates.autoDownload" @change="set({ autoDownload: ($event.target as HTMLInputElement).checked })" /></span></label>
      <label v-if="s.updates.autoCheck && s.updates.autoDownload && updater.canTellMetered" class="tgl"><div class="grow"><div class="t">Only on Wi-Fi</div><div class="s">On mobile data the download waits for Wi-Fi</div></div><span class="tg"><input type="checkbox" :checked="s.updates.wifiOnly" @change="set({ wifiOnly: ($event.target as HTMLInputElement).checked })" /></span></label>
    </div>
    <div class="card">
      <div class="li"><div class="grow"><div class="t">What's new</div><div class="s">Release notes for every version</div></div><button class="btn o s" @click="router.push('/settings/changelog')">Open</button></div>
      <div class="li"><div class="grow"><div class="t">Somnium on GitHub</div><div class="s">Source code, all releases and installation help</div></div><a class="btn o s" :href="REPO_URL" target="_blank" rel="noopener">Open</a></div>
    </div>
  </div>
</template>
