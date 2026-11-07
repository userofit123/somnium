<script setup lang="ts">
// Settings (PLAN.md §6.7), in sections: a list on the left on a computer, one screen per section on a phone.
// Security, Notifications and Sleep come with their own tasks; the sections here are the app shell's.
import { goBack } from "../core/leave";
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { READY_FEATURES, CYCLE_RANGE, cycleOf } from "@somnium/shared";
import { useMe, useSettings, saveSettings, loaded } from "../api/queries";
import { session, signOut, isLocalAccount } from "../core/session";
import { isPhone, layoutChoice, setLayout } from "../core/device";
import { appearanceOpen } from "../core/ui";
import Icon from "../components/Icon.vue";
import AppSelect from "../components/AppSelect.vue";
import NumStep from "../components/NumStep.vue";
import TimePicker from "../components/TimePicker.vue";
import BackupSection from "../components/settings/BackupSection.vue";
import AccountSection from "../components/settings/AccountSection.vue";
import SecuritySection from "../components/settings/SecuritySection.vue";
import DataSection from "../components/settings/DataSection.vue";
import AdminSection from "../components/settings/AdminSection.vue";
import AppVersionsSection from "../components/settings/AppVersionsSection.vue";
import ChangelogSection from "../components/settings/ChangelogSection.vue";
import AccountsSection from "../components/settings/AccountsSection.vue";
import LocalModelSection from "../components/settings/LocalModelSection.vue";
import ActivityLogSection from "../components/settings/ActivityLogSection.vue";
import NotificationsSection from "../components/settings/NotificationsSection.vue";

const route = useRoute(), router = useRouter();
const me = useMe();
const s = useSettings();
const sec = computed(() => String(route.params.section || (isPhone.value ? "" : "account")));
// the sections in groups, so the list reads as a few short ones: [key, name, icon, what's in it]
type Section = [key: string, name: string, icon: string, hint: string];
// local accounts have no server: the server-only sections (admin) stay out of the list
const local = ref(false);
isLocalAccount().then((v) => { local.value = v; });
// order as in PLAN.md §6.7
const ALL = computed<[string, Section[]][]>(() => [
  ["You", [["account", "Account", "user", "Name, password, devices, sync"],
    // the apps keep several servers and on-device accounts; in a browser the server is the site, so this only names it
    (globalThis as any).somniumNative?.accounts ? ["accounts", "Servers & accounts", "server", "Switch, add or remove a server"] : ["accounts", "Server", "server", location.host],
    ["security", "Security", "lock", "App lock, password, two-factor, recovery"]]],
  ["App", [["appearance", "Appearance", "palette", "Colours, style, layout"], ["formats", "Formats", "calendar", "Week start, dates, clock"], ["notifications", "Notifications", "bell", "Reality check reminders"],
    ["sleep", "Sleep", "moon", "Bedtime, wake time, cycle length"], ["features", "Features", "sparkle", "Switch extras on or off"]]],
  ["Your data", [["backup", "Backup & restore", "download", "A copy of everything"], ["data", "Export & import", "upload", "JSON, Markdown, CSV"], ["log", "Activity log", "history", "Everything you changed"]]],
  ["About", [["versions", "App & Versions", "refresh", "Installed version, downloads"], ["changelog", "What's new", "sparkle", "Release notes"],
    ...(session.user?.role === "admin" && !local.value ? [["admin", "Server admin", "server", "People, invites, sign-ups"] as Section] : []), ["about", "About Somnium", "info", "Version, credits"]]],
]);
// words people look for that the names don't carry
const KEYWORDS: Record<string, string> = {
  account: "name username devices signed in sync delete", security: "lock delay idle device verification password recovery key two-factor 2fa authenticator backup codes sign out everywhere checklist screenshots",
  accounts: "server local switch", appearance: "theme dark light colours colors font density layout", formats: "week date clock 12 24 hour", notifications: "reminders reality check quiet hours wbtb morning practice",
  sleep: "bedtime wake cycle 90 minutes", features: "optional extras", backup: "restore automatic encrypted", data: "export import json delete", log: "activity history", versions: "update download", changelog: "release notes", admin: "invites sign-ups people", about: "licence license credits",
};
const q = ref("");
const GROUPS = computed<[string, Section[]][]>(() => {
  const t = q.value.trim().toLowerCase();
  if (!t) return ALL.value;
  return ALL.value.map(([g, xs]) => [g, xs.filter(([k, n, , h]) => `${n} ${h} ${KEYWORDS[k] ?? ""}`.toLowerCase().includes(t))] as [string, Section[]]).filter(([, xs]) => xs.length);
});
const SECTIONS = computed(() => ALL.value.flatMap(([, xs]) => xs));
const go = (k: string) => router.push(`/settings/${k}`);
const set = (patch: Record<string, unknown>) => saveSettings(patch);
const groups = computed(() => { const m = new Map<string, typeof READY_FEATURES>(); for (const f of READY_FEATURES) m.set(f.group, [...(m.get(f.group) ?? []), f]); return [...m]; });
// show the page once its data is in, all at once
await loaded(me);
</script>

<template>
  <div class="page">
    <div class="ph"><div><button v-if="isPhone && sec" class="back" @click="goBack(router, '/settings')"><Icon name="left" :size="16" /><span>Settings</span></button><h1>{{ isPhone && sec ? SECTIONS.find((x) => x[0] === sec)?.[1] : "Settings" }}</h1></div></div>
    <div :class="isPhone ? '' : 'grid'" :style="isPhone ? undefined : { gridTemplateColumns: '220px minmax(0,1fr)', alignItems: 'start' }">
      <!-- phone: the groups as short lists, each row saying what's inside -->
      <div v-if="isPhone && !sec">
        <input v-model="q" type="search" class="sq sqp" placeholder="Search settings" aria-label="Search settings" />
      <p v-if="!GROUPS.length" class="tiny">Nothing matches.</p>
        <template v-for="([g, xs], gi) in GROUPS" :key="g">
          <div class="sh" :class="{ first: gi === 0 }"><h2>{{ g }}</h2></div>
          <div class="card flush">
            <div v-for="[k, l, ic, h] in xs" :key="k" class="li click" @click="go(k)"><span class="bi sg"><Icon :name="ic" :size="17" /></span><div class="grow"><div class="t">{{ l }}</div><div class="s">{{ h }}</div></div><Icon name="right" :size="16" class="muted" /></div>
          </div>
        </template>
        <div class="card flush spt"><div class="li click" @click="signOut()"><span class="bi sg"><Icon name="logout" :size="17" /></span><span class="grow t">Sign out</span></div></div>
      </div>
      <!-- computer: the same groups down the side -->
      <!-- a div, not <nav>: the app's <nav> styles are the side rail's -->
      <div v-else-if="!isPhone" class="card snav" role="navigation" aria-label="Settings sections">
        <input v-model="q" type="search" class="sq" placeholder="Search settings" aria-label="Search settings" />
      <p v-if="!GROUPS.length" class="tiny">Nothing matches.</p>
        <template v-for="[g, xs] in GROUPS" :key="g">
          <div class="sng">{{ g }}</div>
          <button v-for="[k, l, ic] in xs" :key="k" type="button" class="sni" :class="{ on: sec === k }" :aria-current="sec === k ? 'page' : undefined" @click="go(k)"><Icon :name="ic" :size="17" /><span>{{ l }}</span></button>
        </template>
      </div>
      <Transition name="sw" mode="out-in"><div v-if="sec" :key="sec" class="stack">
        <AccountSection v-if="sec === 'account'" />
        <SecuritySection v-else-if="sec === 'security'" />

        <!-- how dates and times read everywhere (DatePicker, TimePicker) -->
        <template v-else-if="sec === 'formats'">
          <div class="card">
            <div class="frow">
              <div class="fld"><label>First day of the week</label><AppSelect :model-value="s.firstDay" :options="[{ value: 0, label: 'Sunday' }, { value: 1, label: 'Monday' }]" title="First day of the week" @update:model-value="(v) => set({ firstDay: v })" /></div>
              <div class="fld"><label>Dates</label><AppSelect :model-value="s.dateFormat" :options="[{ value: 'dmy', label: '31 Dec 2026' }, { value: 'mdy', label: 'Dec 31, 2026' }, { value: 'ymd', label: '2026-12-31' }]" title="Dates" @update:model-value="(v) => set({ dateFormat: v })" /></div>
              <div class="fld"><label>Clock</label><AppSelect :model-value="s.clock" :options="[{ value: '24', label: '24-hour' }, { value: '12', label: '12-hour' }]" title="Clock" @update:model-value="(v) => set({ clock: v })" /></div>
            </div>
          </div>
        </template>

        <template v-else-if="sec === 'sleep'">
          <p class="muted" style="margin:0">Used by the reality check window, the bedtime and WBTB reminders, Home and the WBTB planner.</p>
          <div class="card">
            <div class="frow">
              <div class="fld"><label>I usually go to bed at</label><TimePicker :model-value="s.sleep.bedtime" title="Bedtime" @update:model-value="(v) => set({ sleep: { bedtime: v } })" /></div>
              <div class="fld"><label>I usually wake at</label><TimePicker :model-value="s.sleep.wake" title="Wake time" @update:model-value="(v) => set({ sleep: { wake: v } })" /></div>
            </div>
            <div class="li"><div class="grow"><div class="t">Sleep cycle</div><div class="s">{{ CYCLE_RANGE.min }} to {{ CYCLE_RANGE.max }} min; 90 is usual. The WBTB planner counts alarms in whole cycles.</div></div>
              <NumStep :value="cycleOf(s.sleep.cycle)" :min="CYCLE_RANGE.min" :max="CYCLE_RANGE.max" :step="CYCLE_RANGE.step" unit="min" label="Sleep cycle" @set="(v) => set({ sleep: { cycle: v } })" /></div>
          </div>
        </template>

        <template v-else-if="sec === 'features'">
          <p class="muted" style="margin:0">Somnium shows only what you use. Switch on what you want; switched off, a feature is gone from every screen.</p>
          <p v-if="!groups.length" class="tiny">Nothing to switch on yet: the optional features come with their own tasks.</p>
          <template v-for="[g, fs] in groups" :key="g"><div class="sh"><h2>{{ g }}</h2></div>
            <div class="card"><label v-for="f in fs" :key="f.id" class="tgl"><div class="grow"><div class="t">{{ f.name }}</div><div class="s">{{ f.desc }}</div></div><span class="tg"><input type="checkbox" :checked="!!s.features[f.id]" @change="set({ features: { [f.id]: ($event.target as HTMLInputElement).checked } })" /></span></label></div></template>
          <LocalModelSection v-if="s.features.localModel" />
        </template>

        <template v-else-if="sec === 'appearance'">
          <div class="card">
            <div class="li"><div class="grow"><div class="t">Colours, background, style and layout</div><div class="s">The Appearance panel</div></div><button class="btn s" data-theme-open @click.stop="appearanceOpen = true">Open</button></div>
            <div class="li"><div class="grow"><div class="t">Layout</div><div class="s">Phone or computer layout, or choose by screen size</div></div>
              <AppSelect :model-value="layoutChoice" :options="[{ value: 'auto', label: 'Automatic' }, { value: 'desktop', label: 'Computer' }, { value: 'phone', label: 'Phone' }]" title="Layout" style="width:auto" @update:model-value="setLayout" /></div>
          </div>
        </template>

        <Suspense v-else-if="sec === 'notifications'"><NotificationsSection /></Suspense>
        <BackupSection v-else-if="sec === 'backup'" />
        <DataSection v-else-if="sec === 'data'" />
        <ActivityLogSection v-else-if="sec === 'log'" />
        <AppVersionsSection v-else-if="sec === 'versions'" />
        <ChangelogSection v-else-if="sec === 'changelog'" />
        <AccountsSection v-else-if="sec === 'accounts'" />
        <AdminSection v-else-if="sec === 'admin'" />

        <template v-else-if="sec === 'about'">
          <div class="card">
            <div class="li"><div class="grow"><div class="t">Somnium</div><div class="s">Version {{ session.version }} · API level {{ session.apiLevel }}</div></div></div>
            <div class="li"><div class="grow"><div class="t">Look and feel</div><div class="s">From Money Manager and Motus. Fonts: Inter and Nunito (SIL Open Font License)</div></div></div>
            <div class="li"><div class="grow"><div class="t">Reading text from photos</div><div class="s">tesseract.js, its engine and the English model from tessdata (Apache License 2.0), kept in the app and run on this device</div></div></div>
            <div class="li"><div class="grow"><div class="t">Source</div><div class="s">github.com/userofit123/somnium</div></div></div>
          </div>
        </template>
      </div></Transition>
    </div>
  </div>
</template>

<style scoped>
.sq { width: 100%; box-sizing: border-box; margin-bottom: var(--hg); }
.sqp { margin-bottom: var(--spg); }
/* the computer's section list: small group names over plain rows, the open one filled */
.snav { position: sticky; top: calc(24px + var(--st)); padding: calc(var(--cpy) / 2); display: flex; flex-direction: column; gap: 1px; }
/* the group names and rows share one side inset, and the first group name sits that far below the top too, so the
   list's space is even all round (a 4px top here left it closer to the top than to the sides) */
.sng { font-size: var(--fs-xs); font-weight: 700; letter-spacing: .6px; text-transform: uppercase; color: var(--tx2); padding: calc(var(--cpx) - 4px) calc(var(--cpx) - 4px) 4px; }
.sni { display: flex; align-items: center; gap: 12px; padding: calc(var(--lpy) - 2px) calc(var(--cpx) - 4px); border: 0; background: none; border-radius: var(--r-sm); color: var(--tx); font: inherit; font-size: 14px; text-align: start; cursor: pointer; }
.sni:hover { background: var(--s2); }
.sni.on { background: var(--accc); color: var(--onc); font-weight: 600; }
.sni .ico { color: var(--tx2); }
.sni.on .ico { color: inherit; }
</style>
