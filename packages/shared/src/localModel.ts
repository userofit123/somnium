// The optional local text model hook (PLAN.md §11, LDJ-42): pure parts. The address rules are the servers' (loopback and the
// private LAN for http, https anywhere); the prompts hold the one dream's text and a fixed instruction, nothing else.
import { checkServerAddress, type AddressCheck } from "./servers";
import { ELEMENT_KINDS, type ElementKind } from "./types";

export const LOCAL_MODEL_WARNING = "When you use this, the dream's text is sent to this address. Only use a computer you control.";
export const LOCAL_MODEL_TIMEOUT_MS = 60_000;
/** the only two paths the desktop app will call on the address */
export const LOCAL_MODEL_PATHS = ["/api/tags", "/api/generate"] as const;

/** Ollama's address: a bare "192.168.1.5" gets its default port, http for a private address (the same rules as servers). */
export function checkModelAddress(input: string): AddressCheck {
  const s = String(input ?? "").trim();
  if (!s) return { ok: false, error: "Enter the address of your Ollama computer" };
  const r = checkServerAddress(s);
  if (!r.ok) return r;
  // a path, query or login on the address is dropped by the origin: only the origin is ever called
  return r;
}

export const cleanModelName = (m: unknown): string => String(m ?? "").trim().slice(0, 100);

const SUMMARY_PROMPT = "Summarise the dream below in two or three plain sentences. Describe only what is in the text; do not interpret it or add anything.";
const ELEMENTS_PROMPT = "List the main characters, places, objects and feelings in the dream below, one per line, as: kind: name. Kinds: character, place, object, emotion. No other text.";

/** One request body for POST /api/generate, non-streaming. `text` is the dream's own text and nothing else goes in. */
export function buildGenerateBody(task: "summary" | "elements", model: string, dreamText: string): { model: string; prompt: string; stream: false } {
  return { model, prompt: `${task === "summary" ? SUMMARY_PROMPT : ELEMENTS_PROMPT}\n\n---\n${dreamText.trim()}\n---`, stream: false };
}

const KINDS = new Set<string>(ELEMENT_KINDS);
const ALIAS: Record<string, ElementKind> = { feeling: "emotion", person: "character", people: "character", location: "place", thing: "object" };

/** "character: A tall woman" lines (bullets and numbers tolerated) → at most 12 distinct named elements; the rest is ignored. */
export function parseElementLines(reply: string, max = 12): { kind: ElementKind; name: string }[] {
  const out: { kind: ElementKind; name: string }[] = [], seen = new Set<string>();
  for (const raw of String(reply ?? "").split(/\r?\n/)) {
    const m = /^\s*(?:[-*•]|\d+[.)])?\s*\**([A-Za-z_ ]{3,12}?)\**\s*:\s*(.+?)\s*$/.exec(raw);
    if (!m) continue;
    const k = m[1]!.trim().toLowerCase();
    const kind = (KINDS.has(k) ? k : ALIAS[k]) as ElementKind | undefined;
    const name = m[2]!.replace(/^[*"'\s]+|[*"'.\s]+$/g, "").slice(0, 60);
    if (!kind || kind === "dream_sign" || !name) continue;
    const key = `${kind}:${name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key); out.push({ kind, name });
    if (out.length >= max) break;
  }
  return out;
}

/** The summary as it is kept in the night's sealed notes: one line, marked as made by the person's own model. */
export function summaryNote(existing: string | null | undefined, summary: string): string {
  const line = `Summary (my model): ${summary.replace(/\s+/g, " ").trim()}`;
  return existing?.trim() ? `${existing.trim()}\n${line}` : line;
}
