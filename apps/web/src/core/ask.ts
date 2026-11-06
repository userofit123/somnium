// Questions that need an answer before going on: "Delete this dream?", "Name the tag". Shown by AskHost.vue.
import { reactive } from "vue";

interface Ask { title: string; text?: string; ok: string; no?: string; danger?: boolean; noHistory?: boolean; input?: { value: string; placeholder?: string; secret?: boolean; autocomplete?: string } | null; choices?: { label: string; value: string }[]; resolve: (v: any) => void }
export const asking = reactive<{ cur: Ask | null }>({ cur: null });

// noHistory: asked while the router is already moving (leaving a page), so the question must not add a Back step of its own
// no: the label of the button that says no ("Not now"), Cancel when not given
export const confirm = (title: string, o: { text?: string; ok?: string; no?: string; danger?: boolean; noHistory?: boolean } = {}) =>
  new Promise<boolean>((resolve) => { asking.cur = { title, text: o.text, ok: o.ok ?? "OK", no: o.no, danger: o.danger, noHistory: o.noHistory, resolve }; });
// secret: a password, typed hidden and given back as typed (spaces count); the button waits until something is typed
// autocomplete: "new-password" for a password being chosen, so the browser does not fill in the saved one
export const prompt = (title: string, o: { value?: string; placeholder?: string; ok?: string; text?: string; secret?: boolean; autocomplete?: "current-password" | "new-password"; danger?: boolean } = {}) =>
  new Promise<string | null>((resolve) => { asking.cur = { title, text: o.text, ok: o.ok ?? "Save", danger: o.danger, input: { value: o.value ?? "", placeholder: o.placeholder, secret: o.secret, autocomplete: o.secret ? (o.autocomplete ?? "current-password") : undefined }, resolve }; });
export const choose = (title: string, choices: { label: string; value: string }[], text?: string) =>
  new Promise<string | null>((resolve) => { asking.cur = { title, text, ok: "", choices, resolve }; });
