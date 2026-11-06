<script setup lang="ts">
// What's new: every version's notes, newest first, from the CHANGELOG.md bundled with the app (so it works offline
// and matches what is installed). A newer release found online is shown on top, marked "Available".
// The text is shown as plain text through a tiny parser (headings, "- " bullets, paragraphs), never as HTML.
import { computed } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { session } from "../../core/session";
import { updater } from "../../core/updater";
import { latestRelease, detectPlatform, newer } from "../../core/releases";
import changelog from "../../../../../CHANGELOG.md?raw";

type Line = { kind: "h" | "li" | "p"; text: string };
type Version = { version: string; date: string; lines: Line[]; available?: boolean };

function lines(md: string): Line[] {
  const out: Line[] = [];
  for (const raw of md.split("\n")) {
    const t = raw.trim();
    if (!t) continue;
    const h = /^#{1,6}\s+(.*)$/.exec(t);
    const li = /^[-*]\s+(.*)$/.exec(t);
    out.push(h ? { kind: "h", text: h[1]! } : li ? { kind: "li", text: li[1]! } : { kind: "p", text: t });
  }
  return out;
}

// split at each "## [x.y.z] - date" heading; text before the first one (the file's intro) is dropped
const bundled: Version[] = changelog.split(/^## /m).slice(1).flatMap((block) => {
  const nl = block.indexOf("\n");
  const m = /^\[?([^\]\s]+)\]?(?:\s*-\s*(.*))?$/.exec((nl < 0 ? block : block.slice(0, nl)).trim());
  return m ? [{ version: m[1]!, date: m[2] ?? "", lines: lines(nl < 0 ? "" : block.slice(nl + 1)) }] : [];
});

const rel = useQuery({ queryKey: ["static", "release"], queryFn: latestRelease, staleTime: 3600_000, refetchOnWindowFocus: false, retry: false });
const platform = detectPlatform();
const installed = computed(() => (platform.app && updater.appVersion) || import.meta.env.VITE_VERSION || session.version || "");
const versions = computed<Version[]>(() => {
  const latest = rel.data.value?.latest;
  const ahead = latest && installed.value && newer(latest, installed.value) && !bundled.some((v) => v.version === latest);
  return ahead ? [{ version: latest, date: "", lines: lines(String(rel.data.value?.notes ?? "")), available: true }, ...bundled] : bundled;
});
</script>

<template>
  <div class="stack">
    <div v-for="v in versions" :key="v.version" class="card">
      <div class="lbl hgap">Version {{ v.version }}<template v-if="v.date"> · {{ v.date }}</template><template v-if="v.available"> · Available</template><template v-else-if="v.version === installed"> · Installed</template></div>
      <template v-for="(l, i) in v.lines" :key="i">
        <div v-if="l.kind === 'h'" class="t">{{ l.text }}</div>
        <div v-else-if="l.kind === 'li'" class="tiny" style="color:var(--tx);line-height:1.6">- {{ l.text }}</div>
        <div v-else class="tiny" style="line-height:1.6">{{ l.text }}</div>
      </template>
    </div>
  </div>
</template>
