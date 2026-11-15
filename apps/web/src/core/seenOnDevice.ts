// What the dream editor remembers having shown on this device: the calm notes (LDJ-158) and "In this dream" (LDJ-110),
// and which first-time "why this works" notes were put away with Got it (LDJ-157, components/learn/WhyNote.vue).
// Ids, kinds and times only, nothing of what a dream says. Kept per app account and person, like the native reminders
// (LDJ-202), so one account's entries never suppress another's on a shared phone; with no one signed in nothing is
// read or kept. Signing out and removing the account clear them (forgetStoredDrafts).
import { current as currentAccount } from "../native/accounts";
import { readJson, writeJson } from "./prefs";
import { session } from "./session";

const HARD = "somniumHardNoteSeen", SIGNS = "somniumSignsShown", WHY = "somniumWhySeen";
const owned = (k: string): string | null => {
  const account = currentAccount()?.id, user = session.user?.id;
  return account && user ? `${k}:${account}:${user}` : null;
};

export type HardSeen = Record<string, { at: number; dream: string } | undefined>;
export const readHardSeen = (): HardSeen => { const k = owned(HARD); return (k && readJson<HardSeen>(k, {})) || {}; };
export const writeHardSeen = (v: HardSeen) => { const k = owned(HARD); if (k) writeJson(k, v); };

/** The dreams "In this dream" was shown for: the newest few hundred ids. */
export const readSignsShown = (): string[] => { const k = owned(SIGNS), v = k ? readJson<unknown>(k, []) : []; return Array.isArray(v) ? (v as string[]) : []; };
export const rememberSignsShown = (id: string) => { const k = owned(SIGNS); if (k) writeJson(k, [...readSignsShown().filter((x) => x !== id), id].slice(-300)); };

/** The first-time notes put away with Got it: note ids only. With no one signed in, none count as seen. */
export const readWhySeen = (): string[] => { const k = owned(WHY), v = k ? readJson<unknown>(k, []) : []; return Array.isArray(v) ? (v as string[]) : []; };
export const rememberWhySeen = (id: string) => { const k = owned(WHY); if (k) writeJson(k, [...readWhySeen().filter((x) => x !== id), id]); };
