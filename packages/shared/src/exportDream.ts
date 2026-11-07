// One dream as it is read and as it is kept (PLAN.md §6.2, LDJ-15): the marks and the night's facts as plain lines
// (the dream page shows the same ones it exports), and the Markdown file built on the device. Pure: nothing here
// reads a store or sends anything, so the text of a dream never leaves the device through it.
import type { Dream, Element, Night } from "./types";
import { DSA_ANCHORS } from "./habits";
import { minutesToSleep } from "./rates";
import { CONTROL_ANCHORS, ELEMENT_KIND_LABEL, EMOTION_ANCHORS, LUCIDITY_ANCHORS, RECALL_ANCHORS, SLEEP_ANCHORS, TECHNIQUES, VIVIDNESS_ANCHORS, clockOf } from "./journal";

export type DreamMarksInput = Pick<Dream, "lucid" | "lucidityLevel" | "vividness" | "control" | "recallClarity" | "emotionOverall" | "nightmare" | "recurring" | "falseAwakening" | "sleepParalysis" | "favourite"> & { awareness?: number | null; badDream?: boolean };
export type NightFactsInput = Pick<Night, "bedtime" | "wakeTime" | "sleepQuality" | "wbtbUsed" | "wbtbMinutesAwake" | "nap" | "techniquesDone" | "minutesToSleep">;

/** The marks with their words (older dreams marked lucid without a level read just "Lucid"): lucid level with its anchor, vividness, control, emotion, then the yes-or-no ones. */
export function dreamMarks(d: DreamMarksInput): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  if (d.lucid) out.push({ label: "Lucid", value: d.lucidityLevel > 0 ? `${d.lucidityLevel} · ${LUCIDITY_ANCHORS[d.lucidityLevel] ?? ""}`.replace(/ · $/, "") : "Yes" });
  if (d.awareness != null) out.push({ label: "Dreamsign awareness", value: `${d.awareness} · ${DSA_ANCHORS[d.awareness] ?? ""}`.replace(/ · $/, "") });
  if (d.vividness) out.push({ label: "Vividness", value: `${d.vividness} · ${VIVIDNESS_ANCHORS[d.vividness - 1] ?? ""}`.replace(/ · $/, "") });
  if (d.control != null && (d.lucid || d.control > 0)) out.push({ label: "Control", value: `${d.control} · ${CONTROL_ANCHORS[d.control] ?? ""}`.replace(/ · $/, "") });
  if (d.recallClarity) out.push({ label: "Recall", value: `${d.recallClarity} · ${RECALL_ANCHORS[d.recallClarity - 1] ?? ""}`.replace(/ · $/, "") });
  if (d.emotionOverall != null) out.push({ label: "Emotion", value: EMOTION_ANCHORS[d.emotionOverall + 2] ?? "" });
  if (d.nightmare) out.push({ label: "Nightmare", value: "Yes" });
  if (d.badDream && !d.nightmare) out.push({ label: "Bad dream", value: "Yes" }); // one or the other (RESEARCH.md C18)
  if (d.falseAwakening) out.push({ label: "False awakening", value: "Yes" });
  if (d.sleepParalysis) out.push({ label: "Sleep paralysis", value: "Yes" });
  if (d.recurring) out.push({ label: "Recurring", value: "Yes" });
  return out;
}

/** The night's facts as label and value pairs, only the ones that were noted. */
export function nightFacts(n: NightFactsInput | null | undefined): { label: string; value: string }[] {
  if (!n) return [];
  const out: { label: string; value: string }[] = [];
  if (n.nap) out.push({ label: "Sleep", value: "Nap" });
  if (n.bedtime) out.push({ label: "Bedtime", value: clockOf(n.bedtime) });
  if (n.wakeTime) out.push({ label: "Wake time", value: clockOf(n.wakeTime) });
  if (n.sleepQuality) out.push({ label: "Sleep quality", value: `${n.sleepQuality} · ${SLEEP_ANCHORS[n.sleepQuality - 1] ?? ""}`.replace(/ · $/, "") });
  if (n.wbtbUsed) out.push({ label: "WBTB", value: n.wbtbMinutesAwake ? `${n.wbtbMinutesAwake} min awake` : "Yes" });
  const t = (n.techniquesDone ?? []).map((id) => TECHNIQUES.find((x) => x.id === id)?.label ?? id);
  if (t.length) out.push({ label: "Techniques", value: t.join(", ") });
  const asleep = minutesToSleep(n);
  if (asleep != null) out.push({ label: "Time to fall asleep", value: `${asleep} min` });
  return out;
}

export interface ExportDreamInput {
  dream: Pick<Dream, "title" | "text"> & DreamMarksInput;
  night: (NightFactsInput & { date: string }) | null;
  /** the dream's confirmed elements */
  elements: readonly Pick<Element, "kind" | "name" | "isDreamSign">[];
}

const one = (s: string) => s.replace(/\s+/g, " ").trim();
// a Markdown line of ours: a name or title never starts a new block or a link
const plain = (s: string) => one(s).replace(/([\\`*_{}[\]<>#|])/g, "\\$1");

/**
 * The dream as a Markdown file: title, date, marks, text, elements. The file name is the date only (never the title or
 * any of the text: it shows in download lists, and its name is seen by the system).
 */
export function buildDreamMarkdown(i: ExportDreamInput): { filename: string; markdown: string } {
  const date = i.night?.date ?? "";
  const lines: string[] = [`# ${plain(i.dream.title ?? "") || "Untitled dream"}`, ""];
  if (date) lines.push(`Night of ${date}${i.night?.nap ? " (nap)" : ""}`, "");
  const facts = nightFacts(i.night).filter((f) => f.label !== "Sleep");
  const marks = [...dreamMarks(i.dream), ...(i.dream.favourite ? [{ label: "Favourite", value: "Yes" }] : [])];
  if (marks.length) lines.push("## Marks", "", ...marks.map((m) => `- ${m.label}: ${m.value}`), "");
  if (facts.length) lines.push("## The night", "", ...facts.map((m) => `- ${m.label}: ${m.value}`), "");
  lines.push("## Dream", "", (i.dream.text ?? "").trim() || "(No text.)", "");
  const named = i.elements.filter((e) => e.name);
  if (named.length) {
    lines.push("## Elements", "");
    for (const e of named) lines.push(`- ${plain(e.name!)} (${ELEMENT_KIND_LABEL[e.kind] ?? e.kind})${e.isDreamSign ? " - dream sign" : ""}`);
    lines.push("");
  }
  return { filename: `dream-${date || "undated"}.md`, markdown: lines.join("\n").replace(/\n+$/, "\n") };
}
