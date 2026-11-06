<script setup lang="ts">
// Settings → Security (PLAN.md §4.2, §4.4): two-factor sign-in with an authenticator app and eight one-time backup
// codes, ported from Money Manager's SecurityPane; the recovery key (made here from the open data key, shown once); and
// the "Can you get back in?" checklist, each row read from the real state, never assumed. The app lock's rows (PLAN.md §4.3) are here too: its delay can
// change, but no row turns it off. Device verification wraps the data key when set up; nothing else here touches it.
import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import { LOCK_DELAYS, LOCK_IDLE_TIMES } from "@somnium/shared";
import { useQuery } from "@tanstack/vue-query";
import { api } from "../../api/client";
import { useMe, useSettings } from "../../api/queries";
import { useRouter } from "vue-router";
import { keyring } from "../../core/keyring";
import { lockNow } from "../../core/lock";
import { downloadRecoveryKey, makeRecoveryKey } from "../../core/recovery";
import { prompt } from "../../core/ask";
import { toast, toastError } from "../../core/toast";
import { useFmt } from "../../core/format";
import { authKeyFor } from "../../core/auth";
import { qrPath, keyGroups } from "../../core/qr";
import { isLocalAccount } from "../../core/session";
import { checkLocalPassword, localKeys, makeLocalRecoveryKey } from "../../core/localLock";
import type { LocalKeys } from "@somnium/shared";
import { backupLog, folderName } from "../../core/backup";
import { lock, setLockSettings, whileVerifying } from "../../core/lock";
import { deviceStatus, deviceVerifierExists, setUpDevice, turnDeviceOff } from "../../core/unlock";
import AppSelect from "../AppSelect.vue";
import Icon from "../Icon.vue";

const me = useMe();
const fmt = useFmt();
const username = computed(() => me.data.value?.user?.username ?? "");
const localAccount = ref<boolean | null>(null);
isLocalAccount().then((v) => { localAccount.value = v; });
type Security = { totpEnabled: boolean; backupCodesLeft: number; recoveryMadeAt: string | null; passwordChangedAt: string | null; sealed: boolean };
const sec = useQuery({ queryKey: ["settings", "security"], queryFn: () => api.get<Security>("/auth/security"), enabled: computed(() => localAccount.value === false) });
const totp = computed(() => !!sec.data.value?.totpEnabled);
const settings = useSettings();
const router = useRouter();
type Session = { id: string; platform: string; current: boolean };
const sessions = useQuery({ queryKey: ["settings", "sessions"], queryFn: () => api.get<Session[]>("/auth/sessions"), enabled: computed(() => localAccount.value === false) });

// ----- the recovery key: made here, shown once, then only its hash and the wrapped key are on the server -----
const recoveryKey = ref<string | null>(null), keySaved = ref(false);
const journalOpen = ref(keyring.isOpen());
const stopKeyring = keyring.onChange((open) => { journalOpen.value = open; });
onBeforeUnmount(() => { stopKeyring(); recoveryKey.value = null; });
async function makeKey() {
  const replacing = !!sec.data.value?.recoveryMadeAt;
  const password = await prompt(replacing ? "Replace your recovery key" : "Make your recovery key", { text: replacing ? "The old key stops working. Type your password." : "Type your password.", placeholder: "Password", ok: "Next", secret: true }); if (!password) return;
  busy.value = true;
  try { recoveryKey.value = await makeRecoveryKey(await authKeyFor(username.value, password)); keySaved.value = false; sec.refetch(); }
  catch (e) { toastError(e); } finally { busy.value = false; }
}
// a local account (LDJ-53): the same key, kept in the account's record on this device
const localInfo = ref<LocalKeys | null>(null);
const loadLocalInfo = () => localKeys().then((k) => { localInfo.value = k; }).catch(() => {});
isLocalAccount().then((v) => { if (v) void loadLocalInfo(); });
async function makeLocalKey() {
  const replacing = !!localInfo.value?.recoveryMadeAt;
  const password = await prompt(replacing ? "Replace your recovery key" : "Make your recovery key", { text: replacing ? "The old key stops working. Type your password." : "Type your password.", placeholder: "Password", ok: "Next", secret: true }); if (!password) return;
  busy.value = true;
  try {
    if (!(await checkLocalPassword(password))) { toastError(new Error("Wrong password")); return; }
    recoveryKey.value = await makeLocalRecoveryKey(); keySaved.value = false; void loadLocalInfo();
  } catch (e) { toastError(e); } finally { busy.value = false; }
}
function keySavedDone() { recoveryKey.value = null; toast("Recovery key saved"); }

// ----- "Can you get back in?" (PLAN.md §4.4) -----
// Other devices are listed but are not a way back in yet: every device locks and asks for the password, none keeps the
// data key, and recovery signs them out. Once a signed-in device can re-wrap the key (LDJ-10), this row can count.
const otherDevices = computed(() => (sessions.data.value ?? []).filter((x) => !x.current && x.platform !== "api").length);
// The backup row says what actually happened, not what the switch says: automatic backups skip sealed ones (they need
// the password) and, in a plain browser, run only into a picked folder (core/backup.ts maybeAutoBackup). Reworking
// backups is LDJ-35; this only reads the log this device keeps.
const backupFolder = ref<string | null>(null);
onMounted(async () => { backupFolder.value = await folderName(); });
const nativeBackups = !!(globalThis as { somniumNative?: { saveBackup?: unknown } }).somniumNative?.saveBackup;
const capacitorApp = !!(globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();
const backupRow = computed(() => {
  const b = settings.value.backup, lastAt = backupLog().lastAt;
  const period = b.every === "weekly" ? 7 * 86400000 : 86400000;
  const recent = !!lastAt && Date.now() - new Date(lastAt).getTime() <= period + 86400000; // a day's grace for a late run
  const last = lastAt ? `Last one ${fmt.value.date(lastAt, { day: "numeric", month: "short", year: "numeric" })}` : "No backup yet";
  if (!b.on) return { ok: recent, s: `${last} · automatic backups are off`, action: "Turn on" };
  if (recent) return { ok: true, s: `${last} · every ${b.every === "weekly" ? "week" : "day"}`, action: "" };
  const missing = b.encrypt ? "sealed backups need your password, so make one in Backup"
    : !nativeBackups && !capacitorApp && !backupFolder.value ? "needs a folder" : "";
  return { ok: false, s: missing ? `${last} · ${missing}` : last, action: "Backup" };
});
const checks = computed(() => {
  const s = sec.data.value, left = s?.backupCodesLeft ?? 0, br = backupRow.value;
  return [
    { key: "recovery", ok: !!s?.recoveryMadeAt, t: "Recovery key saved",
      s: s?.recoveryMadeAt ? `Made ${fmt.value.date(s.recoveryMadeAt, { day: "numeric", month: "short", year: "numeric" })}` : "Not made yet - without it a forgotten password locks your journal for good",
      action: s?.recoveryMadeAt ? "Replace" : "Make key", run: makeKey, disabled: !journalOpen.value },
    { key: "devices", ok: false, info: true, t: "Other devices signed in",
      s: otherDevices.value ? `${otherDevices.value} other ${otherDevices.value === 1 ? "device" : "devices"} · each locks and asks for your password, so they don't help if you forget it` : "Only this one",
      action: "Devices", run: () => router.push("/settings/account"), disabled: false },
    { key: "codes", ok: totp.value && left > 0, t: "Backup codes saved",
      s: !totp.value ? "Two-factor sign-in is off, so there are none" : left ? `${left} of 8 left` : "None left - make new ones",
      action: totp.value ? "New codes" : "", run: newCodes, disabled: false },
    { key: "backups", ok: br.ok, t: "A recent backup", s: br.s, action: br.action, run: () => router.push("/settings/backup"), disabled: false },
  ] as { key: string; ok: boolean; info?: boolean; t: string; s: string; action: string; run: () => unknown; disabled: boolean }[];
});
const noWayBack = computed(() => !!sec.data.value && checks.value.every((c) => c.info || !c.ok));
// one primary-styled button at a time: a key or codes shown once (their own button), else the sealed journal, else the
// first way back that is missing
const primary = computed(() => {
  if (recoveryKey.value || codes.value || start.value) return "";
  if (sec.data.value?.sealed) return "sealed";
  return checks.value.find((c) => !c.ok && !c.info && c.action && !c.disabled)?.key ?? "";
});

// setting up: the secret shown once, as a QR code and as text, until a code from the app confirms it
const start = ref<{ secret: string; url: string } | null>(null);
const code = ref("");
const qr = computed(() => (start.value ? qrPath(start.value.url) : null));
// the backup codes, shown once right after turning on (or after making new ones)
const codes = ref<string[] | null>(null);
const busy = ref(false);

async function tfaStart() {
  const password = await prompt("Set up two-factor sign-in", { text: "Type your password.", placeholder: "Password", ok: "Next", secret: true }); if (!password) return;
  try { start.value = await api.post("/auth/2fa/start", { authKey: await authKeyFor(username.value, password) }); code.value = ""; } catch (e) { toastError(e); }
}
async function tfaEnable() {
  busy.value = true;
  try { const r = await api.post("/auth/2fa/enable", { code: code.value }); start.value = null; codes.value = r.backupCodes; sec.refetch(); toast("Two-factor sign-in is on"); }
  catch (e) { toastError(e); } finally { busy.value = false; }
}
// turning off needs the password (as its authKey, made here) and a current code or a backup code
async function tfaDisable() {
  const password = await prompt("Turn off two-factor sign-in?", { text: "Type your password. Then a code from the app, or a backup code.", placeholder: "Password", ok: "Next", secret: true }); if (!password) return;
  const c = await prompt("Code", { placeholder: "6-digit code or backup code", ok: "Turn off", danger: true }); if (!c) return;
  try { await api.post("/auth/2fa/disable", { authKey: await authKeyFor(username.value, password), code: c }); codes.value = null; sec.refetch(); toast("Two-factor sign-in is off"); } catch (e) { toastError(e); }
}
async function newCodes() {
  const password = await prompt("New backup codes", { text: "The old ones stop working. Type your password.", placeholder: "Password", ok: "Make new codes", secret: true }); if (!password) return;
  try { codes.value = (await api.post("/auth/2fa/codes", { authKey: await authKeyFor(username.value, password) })).backupCodes; sec.refetch(); } catch (e) { toastError(e); }
}

// ----- the app lock -----
const delays = LOCK_DELAYS.map((d) => ({ value: d.ms, label: d.label }));
const idles = LOCK_IDLE_TIMES.map((d) => ({ value: d.ms, label: d.label }));
const device = ref(deviceStatus());
const deviceExists = ref(false);
onMounted(async () => { deviceExists.value = await deviceVerifierExists(); });
const isApp = !!(globalThis as { somniumNative?: unknown }).somniumNative;
const deviceText = computed(() => {
  if (device.value.on) return "On - your fingerprint, face or screen lock opens the app";
  if (isApp) return "Not available in this app yet - it unlocks with your password";
  if (!deviceExists.value) return "This device has no verification a browser can use, so it unlocks with your password";
  if (device.value.noPrf) return "This device can confirm it is you but can't keep the key safe, so it unlocks with your password";
  return "Off - it unlocks with your password";
});
async function deviceOn() {
  busy.value = true;
  try {
    const r = await whileVerifying(() => setUpDevice(username.value));
    toast(r === "on" ? "Device verification is on" : "This device can't keep the key safe, so it stays with your password");
  } catch (e) { toastError((e as Error)?.name === "NotAllowedError" ? new Error("Verification was cancelled") : e); }
  finally { busy.value = false; device.value = deviceStatus(); }
}
function deviceOff() { turnDeviceOff(); device.value = deviceStatus(); toast("Device verification is off"); }

// the desktop app only: asks the system to leave the window out of screenshots, on by default. Linux has no such request
// (Electron's setContentProtection does nothing there), so the row isn't offered, and a capture tool can ignore it anywhere.
const privacy = (globalThis as { somniumNative?: { privacy?: { canAskSystem: boolean; screenshotsAllowed(): Promise<boolean>; setScreenshotsAllowed(v: boolean): Promise<boolean> } } }).somniumNative?.privacy;
const screenshots = ref(false);
onMounted(async () => { if (privacy) screenshots.value = await privacy.screenshotsAllowed(); });
async function toggleScreenshots() { if (privacy) screenshots.value = await privacy.setScreenshotsAllowed(!screenshots.value); }

const copy = async (text: string, what: string) => { try { await navigator.clipboard.writeText(text); toast(`${what} copied`); } catch { toastError(new Error("Could not copy")); } };
function downloadKey() { downloadRecoveryKey(username.value, recoveryKey.value!); }
function download() {
  const blob = new Blob([`Somnium backup codes for ${username.value}\nEach one signs you in once when you cannot use your authenticator app.\n\n${codes.value!.join("\n")}\n`], { type: "text/plain" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "somnium-backup-codes.txt" });
  a.click(); URL.revokeObjectURL(a.href);
}
</script>

<template>
  <div class="sh first"><h2>App lock</h2></div>
  <p class="tiny hgap">The app locks every time it starts and when you leave it. You can change when, not whether.</p>
  <div class="card flush">
    <div class="li"><div class="grow"><div class="t">Lock after leaving the app</div></div><AppSelect :model-value="lock.settings.delayMs" :options="delays" title="Lock after leaving the app" @change="setLockSettings({ delayMs: $event })" /></div>
    <div class="li"><div class="grow"><div class="t">Lock when idle for</div></div><AppSelect :model-value="lock.settings.idleMs" :options="idles" title="Lock when idle for" @change="setLockSettings({ idleMs: $event })" /></div>
    <div v-if="localAccount === false" class="li"><Icon name="lock" :size="18" class="muted" /><div class="grow"><div class="t">Device verification</div><div class="s">{{ deviceText }}</div></div>
      <button v-if="device.on" class="qb" @click="deviceOff">Turn off</button>
      <button v-else-if="!isApp && deviceExists && !device.noPrf" class="qb" :disabled="busy" @click="deviceOn">Turn on</button></div>
    <div v-if="privacy?.canAskSystem" class="li"><div class="grow"><div class="t">Screenshots</div><div class="s">{{ screenshots ? "Allowed" : "Asks the system to leave this window out of screenshots and screen sharing. Some capture tools may ignore this." }}</div></div>
      <button class="qb" @click="toggleScreenshots">{{ screenshots ? "Ask to block" : "Allow" }}</button></div>
  </div>
  <template v-if="localAccount">
    <div class="sh"><h2>Can you get back in?</h2></div>
    <p class="tiny hgap">This journal is only on this device, sealed with your password. Nobody can send you the password. The recovery key is the way back in.</p>
    <div class="card flush">
      <div class="li"><Icon :name="localInfo?.recoveryMadeAt ? 'check' : 'info'" :size="18" :class="localInfo?.recoveryMadeAt ? 'sec-ok' : 'muted'" />
        <div class="grow"><div class="t">Recovery key saved</div><div class="s">{{ localInfo?.recoveryMadeAt ? `Made ${fmt.date(localInfo.recoveryMadeAt, { day: "numeric", month: "short", year: "numeric" })}` : "Not made yet - without it a forgotten password locks your journal for good" }}</div></div>
        <button class="qb" :class="{ acc: !localInfo?.recoveryMadeAt }" :disabled="!journalOpen || busy" @click="makeLocalKey">{{ localInfo?.recoveryMadeAt ? "Replace" : "Make key" }}</button></div>
    </div>
    <p class="tiny">Your dreams and notes are kept sealed in this device's database: a copy of its files holds no dream text without your password. Dates, counts and ratings stay plain, as on a server. While the journal is open, the key is in the app's memory, and it goes when the app locks.</p>
    <div v-if="recoveryKey" class="card sec-codes">
      <div class="t">Your recovery key</div>
      <p class="s">Save it somewhere safe and private - a password manager, or printed. It opens your journal and sets a new password if you forget yours. It is shown only now; any older key no longer works.</p>
      <code class="key-display sec-key-text">{{ recoveryKey }}</code>
      <div class="sec-actions"><button class="qb" @click="copy(recoveryKey!, 'Recovery key')"><Icon name="copy" :size="15" />Copy</button><button class="qb" @click="downloadRecoveryKey('your journal on this device', recoveryKey!)"><Icon name="download" :size="15" />Download as text</button></div>
      <label class="sec-check"><input v-model="keySaved" type="checkbox" /> I saved my recovery key</label>
      <div class="sec-actions"><button class="btn" :disabled="!keySaved" @click="keySavedDone">Done</button></div>
    </div>
  </template>
  <template v-else-if="localAccount === false">
    <div class="sh"><h2>Can you get back in?</h2></div>
    <p class="tiny hgap">Nobody can send you your password or open your journal for you, the admin included. These are your ways back.</p>
    <div class="card flush">
      <div v-for="c in checks" :key="c.key" class="li">
        <Icon :name="c.ok ? 'check' : 'info'" :size="18" :class="c.ok ? 'sec-ok' : 'muted'" />
        <div class="grow"><div class="t">{{ c.t }}</div><div class="s">{{ c.s }}</div></div>
        <button v-if="c.action" class="qb" :class="{ acc: primary === c.key }" :disabled="c.disabled || busy" @click="c.run">{{ c.action }}</button>
      </div>
    </div>
    <p v-if="noWayBack" class="tiny sec-warn" role="status">None of these is set up. If you forget your password, your journal cannot be opened again. Making a recovery key takes a second.</p>
    <p v-else-if="!journalOpen && sec.data.value?.sealed" class="tiny">Your journal is sealed, so a recovery key cannot be made here until it is open again.</p>

    <!-- the recovery key, once: after this only its hash and the wrapped data key are kept -->
    <div v-if="recoveryKey" class="card sec-codes">
      <div class="t">Your recovery key</div>
      <p class="s">Save it somewhere safe and private - a password manager, or printed. It opens your journal and sets a new password if you forget yours. It is shown only now; any older key no longer works.</p>
      <code class="key-display sec-key-text">{{ recoveryKey }}</code>
      <div class="sec-actions"><button class="qb" @click="copy(recoveryKey!, 'Recovery key')"><Icon name="copy" :size="15" />Copy</button><button class="qb" @click="downloadKey"><Icon name="download" :size="15" />Download as text</button></div>
      <label class="sec-check"><input v-model="keySaved" type="checkbox" /> I saved my recovery key</label>
      <div class="sec-actions"><button class="btn" :disabled="!keySaved" @click="keySavedDone">Done</button></div>
    </div>

    <div class="sh"><h2>Two-factor sign-in</h2></div>
    <p class="tiny hgap">A code from an authenticator app on top of your password. Any app works - Aegis, Google Authenticator, 1Password, ...</p>
    <div class="card flush">
      <div class="li"><Icon name="lock" :size="18" class="muted" /><div class="grow"><div class="t">Authenticator app</div><div class="s">{{ totp ? "On - every sign-in asks for a code" : "Off" }}</div></div>
        <button v-if="!totp && !start" class="qb" @click="tfaStart">Set up</button>
        <button v-else-if="totp" class="qb" @click="tfaDisable">Turn off</button></div>
      <div v-if="totp" class="li"><Icon name="key" :size="18" class="muted" /><div class="grow"><div class="t">Backup codes</div><div class="s">{{ sec.data.value?.backupCodesLeft ?? 0 }} of 8 left · each works once when the app is out of reach</div></div>
        <button class="qb" @click="newCodes">New codes</button></div>
    </div>

    <!-- setting up: scan, then confirm with one code. The secret is shown only now. -->
    <form v-if="start && qr" class="card sec-setup" @submit.prevent="tfaEnable">
      <p class="s">Scan this with your authenticator app, or type the key into it.</p>
      <div class="sec-qrrow">
        <!-- Fixed white and black, not theme tokens: scanners need this contrast in every theme. -->
        <svg class="sec-qr" role="img" aria-label="QR code for the authenticator app" :viewBox="`-4 -4 ${qr.size + 8} ${qr.size + 8}`" shape-rendering="crispEdges"><rect x="-4" y="-4" :width="qr.size + 8" :height="qr.size + 8" fill="#fff" /><path :d="qr.d" fill="#000" /></svg>
        <div class="grow sec-key"><div class="tiny">Key</div><code class="mono sec-code">{{ keyGroups(start.secret) }}</code>
          <div><button type="button" class="qb" @click="copy(start!.secret, 'Key')"><Icon name="copy" :size="15" />Copy key</button><a class="qb" :href="start.url">Open in app</a></div></div>
      </div>
      <div class="fld"><label>The code the app shows now</label><input v-model="code" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="123456" required /></div>
      <div class="sec-actions"><button class="btn" :disabled="busy || code.length < 6">Turn on</button><button type="button" class="qb" @click="start = null">Cancel</button></div>
    </form>

    <!-- the backup codes, once: after this they are only kept hashed -->
    <div v-if="codes" class="card sec-codes">
      <div class="t">Your backup codes</div>
      <p class="s">Keep them somewhere safe - a password manager, or printed. Each signs you in once if you lose the authenticator. They are shown only now.</p>
      <div class="sec-grid"><code v-for="c in codes" :key="c" class="mono sec-code">{{ c }}</code></div>
      <div class="sec-actions"><button class="qb" @click="copy(codes!.join('\n'), 'Codes')"><Icon name="copy" :size="15" />Copy</button><button class="qb" @click="download"><Icon name="download" :size="15" />Download</button><button class="btn" @click="codes = null">I saved them</button></div>
    </div>

    <div class="sh"><h2>Password</h2></div>
    <div class="card flush">
      <div class="li"><div class="grow"><div class="t">Last changed</div><div class="s">{{ sec.data.value?.passwordChangedAt ? fmt.date(sec.data.value.passwordChangedAt, { day: "numeric", month: "short", year: "numeric" }) : "-" }} · change it under Account</div></div></div>
      <div v-if="sec.data.value?.sealed" class="li"><Icon name="lock" :size="18" class="muted" /><div class="grow"><div class="t">Your journal is sealed</div><div class="s">The password was reset, so this device cannot open your dreams. Your recovery key opens them again.</div></div>
        <button class="qb" :class="{ acc: primary === 'sealed' }" @click="lockNow()">Enter recovery key</button></div>
    </div>
    <p class="tiny">The server only ever sees a key made from your password, never the password itself. Your dreams are sealed on this device before they go anywhere.</p>
  </template>
</template>

<style scoped>
.sec-qrrow { display: flex; gap: var(--spg); align-items: flex-start; margin-bottom: var(--spg); }
.sec-qr { width: calc(var(--lmh) * 3); height: calc(var(--lmh) * 3); flex: none; border-radius: var(--r-sm); }
.sec-key { min-width: 0; display: flex; flex-direction: column; gap: var(--hg); }
.sec-code { font-size: var(--fs); word-break: break-all; }
.sec-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--hg) var(--spg); margin: var(--spg) 0; }
.sec-actions { display: flex; align-items: center; gap: var(--hg); flex-wrap: wrap; }
.sec-codes .s { margin-top: var(--hg); }
.sec-ok { color: var(--pos); }
.sec-warn { margin-top: var(--hg); }
.sec-key-text { margin: var(--spg) 0; }
.sec-check { display: flex; align-items: center; gap: var(--hg); margin: var(--spg) 0; font-size: var(--fs-sm); }
@media (max-width: 480px) { .sec-qrrow { flex-direction: column; align-items: center; } }
</style>
