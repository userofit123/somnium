// Optional features (PLAN.md §11): switched on or off in Settings → Features, and absent from every screen while off.
// `on` is the default for a new account: all off, so the app starts clean. `ready: false` marks one that is planned
// and not shown yet.
// `where` says which screens show it; `to` is where the "Open" link goes once it is on (none: nothing to open).
export interface FeatureDef { id: string; name: string; group: string; desc: string; where: string; to?: string; on: boolean; ready?: false }

/** Switches that no longer exist: "Markdown export per dream" and "Share a dream as text" are always in a dream's menu now.
 *  An account that stored them keeps the old values in its settings, unread; withDefaults drops them on load. */
export const RETIRED_FEATURES = ["markdownExport", "shareText"] as const;

export const FEATURES: FeatureDef[] = [
  // Journal
  { id: "voiceNotes", group: "Journal", name: "Voice notes", desc: "Record a dream by voice in the morning (up to 5 minutes); the recording is sealed before it leaves this device.", where: "Capture · Dream editor", to: "/capture", on: false },
  { id: "sketches", group: "Journal", name: "Sketches", desc: "Draw a scene from a dream next to its text.", where: "Dream editor", to: "/journal", on: false },
  { id: "photos", group: "Journal", name: "Photos and OCR", desc: "Add photos to a dream and read a paper journal page into its text. The reading happens on this device; place data is taken out of every photo.", where: "Dream editor", to: "/journal", on: false },
  { id: "dayNotes", group: "Journal", name: "Day notes", desc: "A line about your day, to see what shows up in dreams days later.", where: "Home", to: "/", on: false },
  // Training
  { id: "meditationTimer", group: "Training", name: "Meditation timer", desc: "A quiet timer (5 to 20 minutes) with a soft end tone and a dim screen, logged as a daily habit.", where: "Train", to: "/train", on: false },
  { id: "soundCue", group: "Training", name: "Sound cue training", desc: "Pair a soft tone with reality checks while awake, then play it quietly during a nap or after waking in the night (wake back to bed, targeted lucidity reactivation). On Android the cues play with the screen off; elsewhere keep the app open with the screen on.", where: "Train", to: "/train", on: false },
  { id: "dreamYoga", group: "Training", name: "Dream yoga practices", desc: "Wangyal's four daytime practices as daily habits, shown as a tradition, with their source.", where: "Train", to: "/train", on: false },
  { id: "goals", group: "Training", name: "Goals", desc: "A lucid dream a week, a full journal month, and the like.", where: "Home · Train", to: "/", on: false },
  // Insights
  { id: "reports", group: "Progress", name: "Month report and year in review", desc: "A summary page for each month and year.", where: "Progress", to: "/progress", on: false },
  { id: "typicalThemes", group: "Progress", name: "Typical dream themes", desc: "How often the common dream themes (being chased, falling, flying...) show up in your dreams, beside how many people say they have ever had them.", where: "Progress", to: "/progress", on: false },
  // Advanced
  { id: "localModel", group: "Advanced", name: "Local AI model (advanced)", desc: "Summarise a dream, or ask for its elements, with a text model you run yourself on your own network (an Ollama address). Never a cloud service; only on request. Desktop app only for now.", where: "A dream's ⋮ menu", to: "/settings/local-model", on: false },
  { id: "palette", group: "Advanced", name: "Command palette", desc: "Ctrl+K to jump anywhere (desktop).", where: "Anywhere on a computer", on: false },
];
/** Features that are built and can be switched on (the others are planned and not shown yet). */
export const READY_FEATURES = FEATURES.filter((f) => f.ready !== false);
export const FEATURE_DEFAULTS: Record<string, boolean> = Object.fromEntries(FEATURES.map((f) => [f.id, f.on]));
