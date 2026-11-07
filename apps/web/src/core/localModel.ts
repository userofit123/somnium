// The optional local text model hook (LDJ-42): the setting (kept on this device, never synced: a LAN address belongs to
// this device) and the two calls. Nothing runs by itself; every call starts from a button. The web build cannot call
// another address (its policy is connect-src 'self'), so this works in the desktop app only, where the main process
// makes the call (apps/desktop/src/main.ts). Android: not yet (needs a native plugin and a cleartext rule for the LAN).
import { reactive } from "vue";
import { buildGenerateBody, checkModelAddress, cleanModelName, parseElementLines, type ElementKind } from "@somnium/shared";
import { readJson, writeJson } from "./prefs";
import { native } from "./device";

const KEY = "somniumLocalModel";
export interface LocalModelSetting { url: string; model: string; /** the warning was ticked once */ ack: boolean }
export const localModel = reactive<LocalModelSetting>({ url: "", model: "", ack: false, ...readJson<Partial<LocalModelSetting>>(KEY, {}) });
export function saveLocalModel(p: Partial<LocalModelSetting>) { Object.assign(localModel, p); writeJson(KEY, { url: localModel.url, model: localModel.model, ack: localModel.ack }); }

interface Bridge { call(url: string, path: string, body?: unknown): Promise<any> }
const bridge = (): Bridge | undefined => (globalThis as { somniumNative?: { localModel?: Bridge } }).somniumNative?.localModel;

/** Where this can run, said as the Settings card says it. */
export const modelPlace = (): "desktop" | "android" | "web" => (native.desktop && bridge() ? "desktop" : native.android ? "android" : "web");
/** Ready to use: the desktop app, a valid address, a model name, and the warning ticked. */
export const modelReady = () => modelPlace() === "desktop" && checkModelAddress(localModel.url).ok && !!cleanModelName(localModel.model) && localModel.ack;

const send = (path: "/api/tags" | "/api/generate", body?: unknown) => {
  const b = bridge(); const a = checkModelAddress(localModel.url);
  if (!b) throw new Error("Available in the desktop app");
  if (!a.ok) throw new Error(a.error);
  return b.call(a.origin, path, body);
};

/** Test: the model names the address has, and whether the chosen one is among them. */
export async function testModel(): Promise<{ names: string[]; has: boolean }> {
  const r = await send("/api/tags");
  const names: string[] = Array.isArray(r?.models) ? r.models.map((m: { name?: unknown }) => String(m?.name ?? "")).filter(Boolean) : [];
  const want = cleanModelName(localModel.model);
  return { names, has: names.some((n) => n === want || n === `${want}:latest`) };
}

async function generate(task: "summary" | "elements", dreamText: string): Promise<string> {
  if (!modelReady()) throw new Error("Set up the local model in Settings first");
  const r = await send("/api/generate", buildGenerateBody(task, cleanModelName(localModel.model), dreamText));
  const t = typeof r?.response === "string" ? r.response.trim() : "";
  if (!t) throw new Error("The model sent no answer");
  return t;
}
export const summariseDream = (text: string) => generate("summary", text);
export async function suggestFromModel(text: string): Promise<{ kind: ElementKind; name: string }[]> { return parseElementLines(await generate("elements", text)); }
