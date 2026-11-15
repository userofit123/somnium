// What the command palette lists besides the actions and pages (LDJ-130): techniques, Learn articles and the Settings
// sections. The knowledge base is loaded only when the palette first opens, so none of it is in the first download.
import { shallowRef } from "vue";

export type PaletteEntry = { label: string; hint: string; icon: string; to: string };

/** Settings' sections, as SettingsPage lists them (the admin and server ones stay out: they depend on the account). */
export const SETTINGS_ENTRIES: PaletteEntry[] = ([
  ["account", "Account", "user"], ["security", "Security", "lock"], ["sleep", "Sleep schedule", "moon"],
  ["reminders", "Reminders", "bell"], ["reality-checks", "Reality checks", "eye"], ["features", "Features", "sparkle"],
  ["appearance", "Appearance", "palette"], ["formats", "Formats", "calendar"], ["backup", "Backups", "download"],
  ["data", "Export & import", "upload"], ["log", "Activity log", "history"], ["about", "About and updates", "info"],
] as const).map(([id, label, icon]) => ({ label, hint: "Settings", icon, to: `/settings/${id}` }));

/** Techniques (each opens its Train page) then the other Learn articles; empty until loadKnowledge() has run. */
export const knowledgeEntries = shallowRef<PaletteEntry[]>([]);
let loading: Promise<void> | null = null;
export function loadKnowledge() {
  loading ??= Promise.all([import("@somnium/knowledge/content"), import("@somnium/knowledge/techniques")]).then(([c, t]) => {
    const title = (slug: string) => c.articles.find((a) => a.id === "techniques/" + slug)?.title;
    const techniques = t.techniques.flatMap((x) => { const label = title(x.slug); return label ? [{ label, hint: "Technique", icon: "target", to: `/train/technique/${x.id}` }] : []; });
    // a technique's article is reached from its Train page, so it isn't listed twice
    const articles = c.articles.filter((a) => a.section !== "techniques").map((a) => ({ label: a.title, hint: "Article", icon: "graduation", to: `/learn/${a.id}` }));
    knowledgeEntries.value = [...techniques, ...articles];
  }).catch(() => { loading = null; });
  return loading;
}
