<script setup lang="ts">
// Settings (PLAN.md §6.7), in sections: a list on the left on a computer, one screen per section on a phone.
// Grouped around dreaming first (LDJ-101), as Motus puts its Training group second.
import { goBack } from "../core/leave";
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { READY_FEATURES, CYCLE_RANGE, cycleOf, deviceFormats } from "@somnium/shared";
import { useMe, useSettings, saveSettings, loaded } from "../api/queries";
import { session, signOut, isLocalAccount } from "../core/session";
import { isPhone } from "../core/device";
import { useNeedsRecoveryKey } from "../core/recoveryNudge";
import Icon from "../components/Icon.vue";
import AppSelect from "../components/AppSelect.vue";
import NumStep from "../components/NumStep.vue";
import TimePicker from "../components/TimePicker.vue";
import BackupSection from "../components/settings/BackupSection.vue";
import AccountSection from "../components/settings/AccountSection.vue";
import SecuritySection from "../components/settings/SecuritySection.vue";
import DataSection from "../components/settings/DataSection.vue";
import AdminSection from "../components/settings/AdminSection.vue";
import AppearanceBody from "../shell/AppearanceBody.vue";
import AppVersionsSection from "../components/settings/AppVersionsSection.vue";
import ChangelogSection from "../components/settings/ChangelogSection.vue";
import AccountsSection from "../components/settings/AccountsSection.vue";
import LocalModelSection from "../components/settings/LocalModelSection.vue";
import ActivityLogSection from "../components/settings/ActivityLogSection.vue";
import RemindersSection from "../components/settings/RemindersSection.vue";
import RealityChecksSection from "../components/settings/RealityChecksSection.vue";
import FreeNights from "../components/settings/FreeNights.vue";
import { startSafetyCheck, startSetup } from "../components/setup/useSetup";
import { settingsGroups, type Section } from "./settingsSections";

const route = useRoute(), router = useRouter();
const me = useMe();
const s = useSettings();
// "notifications" was the Reminders section's old address
// old addresses: "notifications" was Reminders, "versions" (App & Versions) is now About and updates
const OLD: Record<string, string> = { notifications: "reminders", versions: "about" };
const sec = computed(() => { const k = String(route.params.section || (isPhone.value ? "" : "account")); return OLD[k] ?? k; });
watch(() => route.params.section, (k) => { if (typeof k === "string" && OLD[k]) void router.replace(`/settings/${OLD[k]}`); }, { immediate: true });
// What's new opens from About and updates, and the Local AI model from its Features row: own screens, not list entries
const SUB: Record<string, [parent: string, title: string]> = { changelog: ["about", "What's new"], "local-model": ["features", "Local AI model"] };
// the sections in groups, so the list reads as a few short ones: [key, name, icon, what's in it]
// local accounts have no server: the server-only sections (admin) stay out of the list
const local = ref(false);
isLocalAccount().then((v) => { local.value = v; });
const ALL = computed(() => settingsGroups({ multiServer: !!(globalThis as any).somniumNative?.accounts, admin: session.user?.role === "admin" && !local.value }));
// words people look for that the names don't carry
const KEYWORDS: Record<string, string> = {
  account: "name username devices signed in sync delete", security: "lock delay idle device verification fingerprint face screen lock windows hello touch id password recovery key two-factor 2fa authenticator backup codes sign out everywhere checklist screenshots",
  accounts: "server sync local switch", appearance: "theme dark light colours colors font density layout", formats: "week date clock 12 24 hour automatic device language", reminders: "notifications alarm wake-up bedtime wbtb wake back to bed morning journal practice lesson tray login test",
  "reality-checks": "reminders notifications quiet hours habit moments checks silent vibrate dream sign",
  sleep: "sleep times bedtime wake cycle 90 minutes free nights sleep in lie-in weekend setup first run onboarding start again morning capture still dim", features: "optional extras voice notes sketches photos goals reports themes command palette local ai model switches", backup: "backups restore automatic encrypted", data: "export import save files json markdown csv delete", log: "activity history", admin: "invites sign-ups people", about: "version update download release notes what's new changelog github licence license credits",
};
// what "Automatic" means here, said under the formats
const device = deviceFormats();
// a value the device didn't report is a fallback: say so rather than state it as fact
const guess = Object.fromEntries((["firstDay", "dateFormat", "clock"] as const).map((k) => [k, device.guessed?.[k] ? " (your device doesn't say)" : ""])) as Record<"firstDay" | "dateFormat" | "clock", string>;
const DAY = ["Sunday", "Monday"], DATES = { dmy: "31 Dec 2026", mdy: "Dec 31, 2026", ymd: "2026-12-31" };
const q = ref("");
const GROUPS = computed<[string, Section[]][]>(() => {
  const t = q.value.trim().toLowerCase();
  if (!t) return ALL.value;
  return ALL.value.map(([g, xs]) => [g, xs.filter(([k, n, , h]) => `${n} ${h} ${KEYWORDS[k] ?? ""}`.toLowerCase().includes(t))] as [string, Section[]]).filter(([, xs]) => xs.length);
});
const SECTIONS = computed(() => ALL.value.flatMap(([, xs]) => xs));
// a dot on Security while there is no recovery key (LDJ-151)
const needsKey = useNeedsRecoveryKey();
const go = (k: string) => router.push(`/settings/${k}`);
const set = (patch: Record<string, unknown>) => saveSettings(patch);
const groups = computed(() => { const m = new Map<string, typeof READY_FEATURES>(); for (const f of READY_FEATURES) m.set(f.group, [...(m.get(f.group) ?? []), f]); return [...m]; });
// show the page once its data is in, all at once
await loaded(me);
</script>

<template>
  <div class="page">
    <div class="ph"><div><button v-if="isPhone && sec" class="back" @click="goBack(router, SUB[sec] ? `/settings/${SUB[sec]![0]}` : '/settings')"><Icon name="left" :size="16" /><span>{{ SUB[sec] ? SECTIONS.find((x) => x[0] === SUB[sec]![0])?.[1] : "Settings" }}</span></button><h1>{{ isPhone && sec ? SUB[sec]?.[1] ?? SECTIONS.find((x) => x[0] === sec)?.[1] : "Settings" }}</h1></div></div>
    <div :class="isPhone ? '' : 'grid set-g'">
      <!-- phone: the groups as short lists, each row saying what's inside -->
      <div v-if="isPhone && !sec">
        <input v-model="q" type="search" class="sq sqp" placeholder="Search settings" aria-label="Search settings" />
        <div v-if="!GROUPS.length" class="card empty"><Icon name="search" :size="34" /><b>Nothing matches "{{ q }}"</b>Try another word, such as sleep, lock or reminders.<br /><button class="btn tonal" type="button" @click="q = ''">Clear search</button></div>
        <template v-for="([g, xs], gi) in GROUPS" :key="g">
          <div class="sh" :class="{ first: gi === 0 }"><h2>{{ g }}</h2></div>
          <div class="card flush">
            <button type="button" v-for="[k, l, ic, h] in xs" :key="k" class="li click" @click="go(k)"><span class="bi sg"><Icon :name="ic" :size="18" /></span><div class="grow"><div class="t">{{ l }}</div><div class="s">{{ h }}</div></div><i v-if="k === 'security' && needsKey" class="ndot" role="img" aria-label="Make your recovery key" /><Icon name="right" :size="16" class="muted" /></button>
          </div>
        </template>
        <div class="card flush spt"><button type="button" class="li click" @click="signOut()"><span class="bi sg"><Icon name="logout" :size="18" /></span><span class="grow t">Sign out</span></button></div>
      </div>
      <!-- computer: the same groups down the side -->
      <!-- a div, not <nav>: the app's <nav> styles are the side rail's -->
      <div v-else-if="!isPhone" class="card snav" role="navigation" aria-label="Settings sections">
        <input v-model="q" type="search" class="sq" placeholder="Search settings" aria-label="Search settings" />
        <!-- inside the side card: the short form, with the one way back -->
        <div v-if="!GROUPS.length" class="empty sm"><b>Nothing matches</b><button class="btn tonal" type="button" @click="q = ''">Clear search</button></div>
        <template v-for="[g, xs] in GROUPS" :key="g">
          <div class="sng">{{ g }}</div>
          <button v-for="[k, l, ic] in xs" :key="k" type="button" class="sni" :class="{ on: sec === k || SUB[sec]?.[0] === k }" :aria-current="sec === k ? 'page' : undefined" @click="go(k)"><Icon :name="ic" :size="17" /><span class="grow">{{ l }}</span><i v-if="k === 'security' && needsKey" class="ndot" role="img" aria-label="Make your recovery key" /></button>
        </template>
      </div>
      <Transition name="sw" mode="out-in"><div v-if="sec" :key="sec" class="stack">
        <AccountSection v-if="sec === 'account'" />
        <SecuritySection v-else-if="sec === 'security'" />

        <!-- how dates and times read everywhere (DatePicker, TimePicker); Automatic follows the device's language -->
        <template v-else-if="sec === 'formats'">
          <div class="card">
            <div class="frow">
              <div class="fld"><label>First day of the week</label><AppSelect :model-value="s.firstDay" :options="[{ value: 'auto', label: `Automatic (from this device)` }, { value: 0, label: 'Sunday' }, { value: 1, label: 'Monday' }]" title="First day of the week" @update:model-value="(v) => set({ firstDay: v })" /></div>
              <div class="fld"><label>Dates</label><AppSelect :model-value="s.dateFormat" :options="[{ value: 'auto', label: 'Automatic (from this device)' }, { value: 'dmy', label: '31 Dec 2026' }, { value: 'mdy', label: 'Dec 31, 2026' }, { value: 'ymd', label: '2026-12-31' }]" title="Dates" @update:model-value="(v) => set({ dateFormat: v })" /></div>
              <div class="fld"><label>Clock</label><AppSelect :model-value="s.clock" :options="[{ value: 'auto', label: 'Automatic (from this device)' }, { value: '24', label: '24-hour' }, { value: '12', label: '12-hour' }]" title="Clock" @update:model-value="(v) => set({ clock: v })" /></div>
            </div>
            <div v-if="[s.firstDay, s.dateFormat, s.clock].includes('auto')" class="s">On this device, Automatic means {{ DAY[device.firstDay] }}{{ guess.firstDay }}, {{ DATES[device.dateFormat] }}{{ guess.dateFormat }} and the {{ device.clock }}-hour clock{{ guess.clock }}.</div>
          </div>
        </template>

        <template v-else-if="sec === 'sleep'">
          <p class="muted m0">Your usual night. Reminders and the wake-up alarm are timed from it.</p>
          <div class="card">
            <div class="frow">
              <div class="fld"><label>I usually go to bed at</label><TimePicker :model-value="s.sleep.bedtime" title="Bedtime" @update:model-value="(v) => set({ sleep: { bedtime: v } })" /></div>
              <div class="fld"><label>I usually wake at</label><TimePicker :model-value="s.sleep.wake" title="Wake time" @update:model-value="(v) => set({ sleep: { wake: v } })" /></div>
            </div>
            <div class="li"><div class="grow"><div class="t">Sleep cycle</div><div class="s">{{ CYCLE_RANGE.min }} to {{ CYCLE_RANGE.max }} min; 90 is usual. One cycle is a round of lighter and deeper sleep. Wake back to bed (WBTB), waking in the night to practise, counts its alarm in whole cycles. <router-link to="/learn/techniques/wbtb" class="lnk inl">What is WBTB?</router-link></div></div>
              <NumStep :value="cycleOf(s.sleep.cycle)" :min="CYCLE_RANGE.min" :max="CYCLE_RANGE.max" :step="CYCLE_RANGE.step" unit="min" label="Sleep cycle" @set="(v) => set({ sleep: { cycle: v } })" /></div>
            <div class="fld"><label>Nights I can sleep in</label><div class="s">The evenings after which you can lie in. Tonight's plan suggests waking in the night (WBTB) only on these.</div><FreeNights /></div>
          </div>
          <div class="card">
            <label class="tgl"><div class="grow"><div class="t">Lie still before writing</div><div class="s">The morning capture opens on a dim screen that asks what you were dreaming, for 20 seconds you can skip. Off, it opens on the key words.</div></div>
              <span class="tg"><input type="checkbox" :checked="s.capture.dim" @change="set({ capture: { dim: ($event.target as HTMLInputElement).checked } })" /></span></label>
          </div>
          <div class="card">
            <div class="li"><div class="grow"><div class="t">First-run setup</div><div class="s">Sleep times, reminders, tonight's technique and extras, in a few short steps</div></div>
              <button type="button" class="btn o s" @click="startSetup">Run setup again</button></div>
            <div class="li"><div class="grow"><div class="t">Safety check</div><div class="s">{{ s.safety.sleepFirst ? "Sleep first is on: no waking in the night (WBTB), CAT alarm or nap suggestions" : "A few yes/no questions; the answers stay on this device" }}</div></div>
              <button type="button" class="btn o s" @click="startSafetyCheck">{{ s.safety.checked ? "Answer again" : "Take it" }}</button></div>
          </div>
        </template>

        <template v-else-if="sec === 'features'">
          <p class="muted m0">Somnium shows only what you use. Switch on what you want; switched off, a feature is gone from every screen.</p>
          <p v-if="!groups.length" class="tiny">Nothing to switch on yet: the optional features come with their own tasks.</p>
          <template v-for="[g, fs] in groups" :key="g"><div class="sh"><h2>{{ g }}</h2></div>
            <div class="card"><label v-for="f in fs" :key="f.id" class="tgl"><div class="grow"><div class="t">{{ f.name }}</div><div class="s">{{ f.desc }}</div>
              <!-- where it shows, and once on a link there (nothing opens for a feature that has no screen of its own) -->
              <div class="s">Shows in: {{ f.where }}<template v-if="s.features[f.id] && f.to"> · <router-link :to="f.to" class="lnk inl" @click.stop>Open</router-link></template></div></div><span class="tg"><input type="checkbox" :checked="!!s.features[f.id]" @change="set({ features: { [f.id]: ($event.target as HTMLInputElement).checked } })" /></span></label></div></template>
        </template>

        <LocalModelSection v-else-if="sec === 'local-model'" />

        <!-- the same options as the rail's quick panel, inline (Layout is in its Layout tab) -->
        <div v-else-if="sec === 'appearance'" class="card apset"><AppearanceBody inline /></div>

        <Suspense v-else-if="sec === 'reminders'"><RemindersSection /></Suspense>
        <Suspense v-else-if="sec === 'reality-checks'"><RealityChecksSection /></Suspense>
        <BackupSection v-else-if="sec === 'backup'" />
        <DataSection v-else-if="sec === 'data'" />
        <ActivityLogSection v-else-if="sec === 'log'" />
        <ChangelogSection v-else-if="sec === 'changelog'" />
        <AccountsSection v-else-if="sec === 'accounts'" />
        <AdminSection v-else-if="sec === 'admin'" />

        <AppVersionsSection v-else-if="sec === 'about'" />
      </div></Transition>
    </div>
  </div>
</template>

<style scoped>
/* the Appearance options bring their own inset */
.apset { padding: 0; overflow: hidden; }
.sq { width: 100%; box-sizing: border-box; margin-bottom: var(--hg); }
.sqp { margin-bottom: var(--spg); }
/* the computer's section list: small group names over plain rows, the open one filled */
.snav { position: sticky; top: calc(24px + var(--st)); padding: calc(var(--cpy) / 2); display: flex; flex-direction: column; gap: 1px; }
/* the group names and rows share one side inset, and the first group name sits that far below the top too, so the
   list's space is even all round (a 4px top here left it closer to the top than to the sides) */
.sng { font-size: var(--fs-xs); font-weight: 700; letter-spacing: .6px; text-transform: uppercase; color: var(--tx2); padding: calc(var(--cpx) - 4px) calc(var(--cpx) - 4px) 4px; }
.sni { display: flex; align-items: center; gap: 12px; padding: calc(var(--lpy) - 2px) calc(var(--cpx) - 4px); border: 0; background: none; border-radius: var(--r-sm); color: var(--tx); font: inherit; font-size: var(--fs); text-align: start; cursor: pointer; }
.sni:hover { background: var(--s2); }
.sni.on { background: var(--accc); color: var(--onc); font-weight: 600; }
.sni .ico { color: var(--tx2); }
.sni.on .ico { color: inherit; }
</style>
