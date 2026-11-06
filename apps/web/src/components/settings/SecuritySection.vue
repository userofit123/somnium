<script setup lang="ts">
// Settings → Security (PLAN.md §4.2, §4.4): two-factor sign-in with an authenticator app and eight one-time backup
// codes, ported from Money Manager's SecurityPane. The recovery key and the "can you get back in?" checklist come
// with LDJ-7; the rows here are the skeleton they join. Nothing in this section ever touches the journal's data key.
import { ref, computed } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { api } from "../../api/client";
import { useMe } from "../../api/queries";
import { prompt } from "../../core/ask";
import { toast, toastError } from "../../core/toast";
import { useFmt } from "../../core/format";
import { authKeyFor } from "../../core/auth";
import { qrPath, keyGroups } from "../../core/qr";
import { isLocalAccount } from "../../core/session";
import Icon from "../Icon.vue";

const me = useMe();
const fmt = useFmt();
const username = computed(() => me.data.value?.user?.username ?? "");
const localAccount = ref<boolean | null>(null);
isLocalAccount().then((v) => { localAccount.value = v; });
type Security = { totpEnabled: boolean; backupCodesLeft: number; recoveryMadeAt: string | null; passwordChangedAt: string | null; sealed: boolean };
const sec = useQuery({ queryKey: ["settings", "security"], queryFn: () => api.get<Security>("/auth/security"), enabled: computed(() => localAccount.value === false) });
const totp = computed(() => !!sec.data.value?.totpEnabled);

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
const copy = async (text: string, what: string) => { try { await navigator.clipboard.writeText(text); toast(`${what} copied`); } catch { toastError(new Error("Could not copy")); } };
function download() {
  const blob = new Blob([`Somnium backup codes for ${username.value}\nEach one signs you in once when you cannot use your authenticator app.\n\n${codes.value!.join("\n")}\n`], { type: "text/plain" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "somnium-backup-codes.txt" });
  a.click(); URL.revokeObjectURL(a.href);
}
</script>

<template>
  <div v-if="localAccount" class="card"><div class="li"><div class="grow"><div class="t">On this device only</div><div class="s">A local account has no sign-in, so there is nothing to protect it with here. The app lock is under Features.</div></div></div></div>
  <template v-else-if="localAccount === false">
    <div class="sh first"><h2>Two-factor sign-in</h2></div>
    <p class="tiny hgap">A code from an authenticator app on top of your password. Any app works - Aegis, Google Authenticator, 1Password, ...</p>
    <div class="card flush">
      <div class="li"><Icon name="lock" :size="18" class="muted" /><div class="grow"><div class="t">Authenticator app</div><div class="s">{{ totp ? "On - every sign-in asks for a code" : "Off" }}</div></div>
        <button v-if="!totp && !start" class="qb acc" @click="tfaStart">Set up</button>
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
        <div class="grow sec-key"><div class="tiny">Key</div><code class="sec-mono">{{ keyGroups(start.secret) }}</code>
          <div><button type="button" class="qb" @click="copy(start!.secret, 'Key')"><Icon name="copy" :size="15" />Copy key</button><a class="qb" :href="start.url">Open in app</a></div></div>
      </div>
      <div class="fld"><label>The code the app shows now</label><input v-model="code" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="123456" required /></div>
      <div class="sec-actions"><button class="btn" :disabled="busy || code.length < 6">Turn on</button><button type="button" class="qb" @click="start = null">Cancel</button></div>
    </form>

    <!-- the backup codes, once: after this they are only kept hashed -->
    <div v-if="codes" class="card sec-codes">
      <div class="t">Your backup codes</div>
      <p class="s">Keep them somewhere safe - a password manager, or printed. Each signs you in once if you lose the authenticator. They are shown only now.</p>
      <div class="sec-grid"><code v-for="c in codes" :key="c" class="sec-mono">{{ c }}</code></div>
      <div class="sec-actions"><button class="qb" @click="copy(codes!.join('\n'), 'Codes')"><Icon name="copy" :size="15" />Copy</button><button class="qb" @click="download"><Icon name="download" :size="15" />Download</button><button class="qb acc" @click="codes = null">I saved them</button></div>
    </div>

    <div class="sh"><h2>Password</h2></div>
    <div class="card flush">
      <div class="li"><div class="grow"><div class="t">Last changed</div><div class="s">{{ sec.data.value?.passwordChangedAt ? fmt.date(sec.data.value.passwordChangedAt, { day: "numeric", month: "short", year: "numeric" }) : "-" }} · change it under Account</div></div></div>
      <div v-if="sec.data.value?.sealed" class="li"><Icon name="lock" :size="18" class="muted" /><div class="grow"><div class="t">Your journal is sealed</div><div class="s">The password was reset, so this device cannot open your dreams. Use your recovery key, or a device that is still signed in, to unlock them again.</div></div></div>
    </div>
    <p class="tiny">The server only ever sees a key made from your password, never the password itself. Your dreams are sealed on this device before they go anywhere.</p>
  </template>
</template>

<style scoped>
.sec-qrrow { display: flex; gap: var(--spg); align-items: flex-start; margin-bottom: var(--spg); }
.sec-qr { width: calc(var(--lmh) * 3); height: calc(var(--lmh) * 3); flex: none; border-radius: var(--r-sm); }
.sec-key { min-width: 0; display: flex; flex-direction: column; gap: var(--hg); }
.sec-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: var(--fs); letter-spacing: .04em; word-break: break-all; }
.sec-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--hg) var(--spg); margin: var(--spg) 0; }
.sec-actions { display: flex; align-items: center; gap: var(--hg); flex-wrap: wrap; }
.sec-codes .s { margin-top: var(--hg); }
@media (max-width: 480px) { .sec-qrrow { flex-direction: column; align-items: center; } }
</style>
