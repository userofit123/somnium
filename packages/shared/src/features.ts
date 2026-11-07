// Optional features (PLAN.md §11): switched on or off in Settings → Features, and absent from every screen while off.
// `on` is the default for a new account: all off, so the app starts clean. `ready: false` marks one that is planned
// and not shown yet.
export interface FeatureDef { id: string; name: string; group: string; desc: string; on: boolean; ready?: false }

export const FEATURES: FeatureDef[] = [
  // Journal
  { id: "voiceNotes", group: "Journal", name: "Voice notes", desc: "Record a dream by voice in the morning (up to 5 minutes); the recording is sealed before it leaves this device.", on: false },
  { id: "sketches", group: "Journal", name: "Sketches", desc: "Draw a scene from a dream next to its text.", on: false },
  { id: "photos", group: "Journal", name: "Photos and OCR", desc: "Add photos to a dream and read a paper journal page into its text. The reading happens on this device; place data is taken out of every photo.", on: false },
  { id: "dayNotes", group: "Journal", name: "Day notes", desc: "A line about your day, to see what shows up in dreams days later.", on: false },
  { id: "markdownExport", group: "Journal", name: "Markdown export per dream", desc: "Save any dream as a Markdown file.", on: false },
  { id: "shareText", group: "Journal", name: "Share a dream as text", desc: "Send a dream's text to another app.", on: false },
  // Train
  { id: "meditationTimer", group: "Train", name: "Meditation timer", desc: "A quiet timer (5 to 20 minutes) with a soft end tone and a dim screen, logged as a daily habit.", on: false },
  { id: "soundCue", group: "Train", name: "Sound cue training", desc: "Pair a soft tone with reality checks while awake, then play it quietly during a nap or after WBTB (targeted lucidity reactivation). Needs the screen on and the app open.", on: false },
  { id: "dreamYoga", group: "Train", name: "Dream yoga practices", desc: "Wangyal's four daytime practices as daily habits, shown as a tradition, with their source.", on: false },
  { id: "goals", group: "Train", name: "Goals", desc: "A lucid dream a week, a full journal month, and the like.", on: false },
  // Home (PLAN.md §6.1): extra cards under the day's own blocks
  { id: "homeSigns", group: "Home", name: "Top dream signs", desc: "Your most frequent dream signs on Home.", on: false },
  { id: "homeLesson", group: "Home", name: "Next lesson", desc: "The course lesson you are on, on Home.", on: false },
  { id: "homeTip", group: "Home", name: "A tip from Learn", desc: "A short article summary from Learn on Home, a different one each day.", on: false },
  { id: "homeLastLucid", group: "Home", name: "Last lucid dream", desc: "The title and date of your latest lucid dream on Home.", on: false },
  // Insights
  { id: "reports", group: "Insights", name: "Month report and year in review", desc: "A summary page for each month and year.", on: false },
  { id: "typicalThemes", group: "Insights", name: "Typical dream themes", desc: "How often the common dream themes (being chased, falling, flying...) show up in your dreams, beside how many people say they have ever had them.", on: false },
  // Integrations
  { id: "localModel", group: "Integrations", name: "Local AI model (advanced)", desc: "Summarise a dream, or ask for its elements, with a text model you run yourself on your own network (an Ollama address). Never a cloud service; only on request. Desktop app only for now.", on: false },
  { id: "palette", group: "Integrations", name: "Command palette", desc: "Ctrl+K to jump anywhere (desktop).", on: false },
];
/** Features that are built and can be switched on (the others are planned and not shown yet). */
export const READY_FEATURES = FEATURES.filter((f) => f.ready !== false);
export const FEATURE_DEFAULTS: Record<string, boolean> = Object.fromEntries(FEATURES.map((f) => [f.id, f.on]));
