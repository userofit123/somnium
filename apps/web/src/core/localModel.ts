// The optional local text model hook (LDJ-42): the setting and the two calls. The desktop app keeps the setting (the
// address, the model and the warning tick) in this account's own record, never synced (a LAN address belongs to this
// computer), and makes the call itself to that saved address only (apps/desktop/src/main.ts localModel:*): the screens
// can't name another address. Nothing runs by itself; every call starts from a button. The web build cannot call another
// address (its policy is connect-src 'self'), so this works in the desktop app only. Android: not yet (needs a native
// plugin and a cleartext rule for the LAN).
import { reactive } from "vue";
import { buildGenerateBody, checkModelAddress, cleanModelName, parseElementLines, type ElementKind, type LocalModelSetting } from "@somnium/shared";
import { native } from "./device";

export type { LocalModelSetting };
export const localModel = reactive<LocalModelSetting & { loaded: boolean }>({ url: "", model: "", ack: false, loaded: false });

interface Bridge {
  get(): Promise<LocalModelSetting | null>;
  set(v: LocalModelSetting): Promise<LocalModelSetting | null>;
  call(path: string, body?: unknown): Promise<any>;
}
const bridge = (): Bridge | undefined => (globalThis as { somniumNative?: { localModel?: Bridge } }).somniumNative?.localModel;
const take = (v: LocalModelSetting | null) => Object.assign(localModel, { url: v?.url ?? "", model: v?.model ?? "", ack: v?.ack === true, loaded: true });

// an older version kept it in this browser's storage: that copy is dropped (the person sets it again, in the account's record)
try { localStorage.removeItem("somniumLocalModel"); } catch { /* storage blocked: nothing was kept */ }

/** Reads the saved setting from the desktop app (once; Settings and the dream page call it). */
export async function loadLocalModel() {
  const b = bridge();
  if (!b) return;
  try { take(await b.get()); } catch { /* not this account's window: nothing shown */ }
}
/** Saves the setting in the desktop app; it refuses an address outside this computer and the private LAN. */
export async function saveLocalModel(p: Partial<LocalModelSetting>) {
  const b = bridge();
  if (!b) throw new Error("Available in the desktop app");
  take(await b.set({ url: p.url ?? localModel.url, model: p.model ?? localModel.model, ack: p.ack ?? localModel.ack }));
}

/** Where this can run, said as the Settings card says it. */
export const modelPlace = (): "desktop" | "android" | "web" => (native.desktop && bridge() ? "desktop" : native.android ? "android" : "web");
/** Ready to use: the desktop app, a saved valid address, a model name, and the warning ticked. */
export const modelReady = () => modelPlace() === "desktop" && checkModelAddress(localModel.url).ok && !!cleanModelName(localModel.model) && localModel.ack;

const send = (path: "/api/tags" | "/api/generate", body?: unknown) => {
  const b = bridge();
  if (!b) throw new Error("Available in the desktop app");
  return b.call(path, body);
};

/** Test: the model names the saved address has, and whether the chosen one is among them. */
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
