<script setup lang="ts">
// Settings → Activity log: what changed in your data and when, newest first, a day at a time (engine: modules/activitylog.ts).
// Changes still waiting to reach the server come first, so it's clear they haven't been sent yet.
import { computed } from "vue";
import { useRouter } from "vue-router";
import { useActivityLog } from "../../api/queries";
import { waiting } from "../../api/outbox";
import { sync, schedule } from "../../api/replica";
import { useFmt } from "../../core/format";
import Icon from "../Icon.vue";

const router = useRouter();
const fmt = useFmt();
const log = useActivityLog();
const entries = computed<any[]>(() => (log.data.value?.pages ?? []).flatMap((p: any) => p.entries));

const ICON: Record<string, string> = { settings: "settings", account: "lock" };
const PLACE: Record<string, (id: string, live?: boolean) => string> = { settings: () => "/settings" };
const target = (e: any) => e.open && PLACE[e.open.kind]?.(e.open.id, e.open.live);
const open = (e: any) => { const to = target(e); if (to) router.push(to); };

// one list per day
const ymd = (iso: string) => new Date(iso).toLocaleDateString("sv-SE");
const days = computed(() => {
  const out: { day: string; items: any[] }[] = [];
  for (const e of entries.value) { const d = ymd(e.at); if (out.at(-1)?.day !== d) out.push({ day: d, items: [] }); out.at(-1)!.items.push(e); }
  return out;
});
const dayName = (d: string) => d === ymd(new Date().toISOString()) ? "Today" : d === ymd(new Date(Date.now() - 86400000).toISOString()) ? "Yesterday" : fmt.value.date(d, { weekday: "long", day: "numeric", month: "long" });
const when = (iso: string) => { const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 1 ? "Just now" : m < 60 ? `${m} min ago` : m < 360 ? `${Math.round(m / 60)} h ago` : fmt.value.time(iso); };
// which device made a change is only worth saying when more than one did
const devices = computed(() => new Set(entries.value.map((e) => e.origin)).size > 1);
const sub = (e: any) => [e.detail, when(e.at), devices.value ? (e.origin ? `device ${e.origin.slice(-4)}` : "server") : ""].filter(Boolean).join(" · ");

// changes kept on this device until the server can be reached
const WHAT: [RegExp, string][] = [[/^\/settings/, "Settings"]];
const outbox = computed(() => waiting.value.map((x) => ({ ...x, what: WHAT.find(([r]) => r.test(x.path))?.[1] ?? "Change" })));
</script>

<template>
  <template v-if="outbox.length || sync.waiting">
    <div class="sh first"><h2>Waiting to sync</h2><button v-if="sync.on" class="lnk" :disabled="sync.syncing" @click="schedule(0)">Sync now</button></div>
    <div class="card">
      <div v-if="sync.waiting" class="li"><span class="bi sg"><Icon name="refresh" :size="16" /></span><div class="grow"><div class="t">{{ sync.waiting }} {{ sync.waiting === 1 ? "change" : "changes" }} saved on this device</div>
        <div class="s">{{ !sync.online ? "Sent when the server can be reached" : sync.syncing ? "Sending…" : "Sent shortly" }}</div></div></div>
      <div v-for="(x, i) in outbox" :key="i" class="li"><span class="bi sg"><Icon name="clock" :size="16" /></span><div class="grow"><div class="t">{{ x.what }}</div><div class="s">{{ x.method === "del" ? "Deleted" : x.method === "post" ? "Added" : "Changed" }} · {{ when(new Date(x.at).toISOString()) }}</div></div></div>
    </div>
  </template>

  <div v-if="log.isLoading.value" class="card" style="opacity:.4;min-height:120px" />
  <div v-else-if="log.isError.value" class="card empty sm"><b>Couldn't load the log</b>{{ (log.error.value as Error)?.message }}<br /><button class="btn tonal" @click="log.refetch()">Try again</button></div>
  <div v-else-if="!entries.length" class="card empty sm"><b>Nothing here yet</b>Everything you change will be listed here: what kind of thing and when, never what it said.</div>
  <template v-for="(d, i) in days" :key="d.day">
    <div class="sh" :class="{ first: i === 0 && !outbox.length && !sync.waiting }"><h2>{{ dayName(d.day) }}</h2></div>
    <div class="card"><div class="list">
      <div v-for="(e, j) in d.items" :key="j" class="li" :class="{ click: target(e) }" :role="target(e) ? 'button' : undefined" :tabindex="target(e) ? 0 : undefined" @click="open(e)" @keydown.enter="open(e)">
        <span class="bi sg"><Icon :name="e.action === 'deleted' ? 'trash' : ICON[e.kind] ?? 'history'" :size="16" /></span>
        <div class="grow"><div class="t">{{ e.text }}</div><div class="s">{{ sub(e) }}</div></div>
        <Icon v-if="target(e)" name="right" :size="16" class="muted" />
      </div>
    </div></div>
  </template>
  <div v-if="log.hasNextPage.value" class="center"><button class="qb" :disabled="log.isFetchingNextPage.value" @click="log.fetchNextPage()">{{ log.isFetchingNextPage.value ? "Loading…" : "Show older" }}</button></div>
</template>
