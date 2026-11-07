// The optional local text model hook (PLAN.md §11, LDJ-42): pure parts. The address may only be this computer or the private
// LAN (http or https), never a public host: the dream's text goes there. The prompts hold the one dream's text and a fixed
// instruction, nothing else.
import { isLocalHost, type AddressCheck } from "./servers";
import { ELEMENT_KINDS, type ElementKind } from "./types";

export const LOCAL_MODEL_WARNING = "When you use this, the dream's text is sent to this address. Only use a computer you control.";
export const LOCAL_MODEL_TIMEOUT_MS = 60_000;
/** the only two paths the desktop app will call on the address */
export const LOCAL_MODEL_PATHS = ["/api/tags", "/api/generate"] as const;

/** Ollama's default port, added to an address given without a scheme or port ("192.168.1.5"). */
export const OLLAMA_PORT = 11434;
/**
 * Ollama's address: loopback (localhost, 127.x, ::1) or a private LAN address (10/8, 172.16/12, 192.168/16, 169.254/16,
 * fc00::/7), over http or https. Only addresses written as numbers (or "localhost"): a name could resolve to a public
 * host, and the dream's text would go there. A bare "192.168.1.5" is http on Ollama's port.
 */
export function checkModelAddress(input: string): AddressCheck {
  const s = String(input ?? "").trim();
  if (!s) return { ok: false, error: "Enter the address of your Ollama computer" };
  const bare = !/^[a-z][a-z0-9+.-]*:\/\//i.test(s);
  let u: URL;
  try { u = new URL(bare ? `http://${s}` : s); } catch { return { ok: false, error: "That doesn't look like an address" }; }
  if (!/^https?:$/.test(u.protocol) || !u.hostname) return { ok: false, error: "The address must start with http:// or https://" };
  if (u.username || u.password) return { ok: false, error: "Leave the name and password out of the address" };
  if (!isLocalHost(u.hostname)) return { ok: false, error: "Only this computer or your home network: an address like 192.168.1.5, 10.0.0.5 or localhost" };
  if (bare && !u.port) u.port = String(OLLAMA_PORT);
  // a path, query or login on the address is dropped by the origin: only the origin is ever called
  const insecure = u.protocol === "http:";
  return { ok: true, origin: u.origin, insecure, ...(insecure && !/^(localhost|127\.|\[::1\])/.test(u.host) ? { warning: "This address uses http, so the dream's text isn't encrypted on the way. Only use it on a network you trust." } : {}) };
}

/** The setting the desktop app keeps per account (main.ts localModel:set); `ack`: the warning was ticked. */
export interface LocalModelSetting { url: string; model: string; ack: boolean }
/** A setting as it may be stored: a valid address (its origin), a model name and the tick, or null. */
export function cleanModelSetting(v: unknown): LocalModelSetting | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const url = String(o.url ?? "").trim(), model = cleanModelName(o.model);
  if (!url && !model) return null;
  const a = url ? checkModelAddress(url) : null;
  if (a && !a.ok) return null;
  return { url: a?.ok ? a.origin : "", model, ack: o.ack === true };
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
