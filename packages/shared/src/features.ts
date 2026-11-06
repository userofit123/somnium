// Optional features (PLAN.md §11): switched on or off in Settings → Features, and absent from every screen while off.
// `on` is the default for a new account: all off, so the app starts clean. `ready: false` marks one that is planned
// and not shown yet.
export interface FeatureDef { id: string; name: string; group: string; desc: string; on: boolean; ready?: false }

export const FEATURES: FeatureDef[] = [
  // Journal
  { id: "voiceNotes", group: "Journal", name: "Voice notes", desc: "Record a dream by voice in the morning; the recording stays sealed on your device and server.", on: false, ready: false },
  { id: "sketches", group: "Journal", name: "Sketches", desc: "Draw a scene from a dream next to its text.", on: false, ready: false },
  { id: "photos", group: "Journal", name: "Photos and OCR", desc: "Photograph a paper journal page; the text is read on your device and added to the dream.", on: false, ready: false },
  { id: "dayNotes", group: "Journal", name: "Day notes", desc: "A line about your day, to see what shows up in dreams days later.", on: false, ready: false },
  { id: "markdownExport", group: "Journal", name: "Markdown export per dream", desc: "Save any dream as a Markdown file.", on: false, ready: false },
  { id: "shareText", group: "Journal", name: "Share a dream as text", desc: "Send a dream's text to another app.", on: false, ready: false },
  // Train
  { id: "meditationTimer", group: "Train", name: "Meditation timer", desc: "A quiet timer for the practices that use one.", on: false, ready: false },
  { id: "dreamYoga", group: "Train", name: "Dream yoga practices", desc: "The contemplative practices, with their sources.", on: false, ready: false },
  { id: "goals", group: "Train", name: "Goals", desc: "A lucid dream a week, a full journal month, and the like.", on: false, ready: false },
  // Home (PLAN.md §6.1): extra cards under the day's own blocks
  // top dream signs waits for the Signs ranking (PLAN.md §7.2, its own task): planned, not shown yet
  { id: "homeSigns", group: "Home", name: "Top dream signs", desc: "Your most frequent dream signs on Home.", on: false, ready: false },
  { id: "homeLesson", group: "Home", name: "Next lesson", desc: "The course lesson you are on, on Home.", on: false },
  { id: "homeTip", group: "Home", name: "A tip from Learn", desc: "A short article summary from Learn on Home, a different one each day.", on: false },
  { id: "homeLastLucid", group: "Home", name: "Last lucid dream", desc: "The title and date of your latest lucid dream on Home.", on: false },
  // Insights
  { id: "reports", group: "Insights", name: "Month report and year in review", desc: "A summary page for each month and year.", on: false, ready: false },
  { id: "typicalThemes", group: "Insights", name: "Typical-dream themes", desc: "How often the common dream themes show up for you, compared with published rates.", on: false, ready: false },
  // Integrations
  { id: "localModel", group: "Integrations", name: "Local text model", desc: "A text model you run yourself on your own network (an Ollama address). Never a cloud service.", on: false, ready: false },
  { id: "palette", group: "Integrations", name: "Command palette", desc: "Ctrl+K to jump anywhere (desktop).", on: false },
];
/** Features that are built and can be switched on (the others are planned and not shown yet). */
export const READY_FEATURES = FEATURES.filter((f) => f.ready !== false);
export const FEATURE_DEFAULTS: Record<string, boolean> = Object.fromEntries(FEATURES.map((f) => [f.id, f.on]));
