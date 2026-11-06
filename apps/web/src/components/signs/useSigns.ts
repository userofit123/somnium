// The numbers behind the Signs screens, worked out on the device from the journal lists as opened here
// (packages/shared/src/signs.ts does the maths). Nothing here goes to the server.
import { computed } from "vue";
import { elementStats, type ElementKind, type SignCategory } from "@somnium/shared";
import { useJournal } from "../../api/journal";
import { useToday } from "../../core/today";

export const KIND_LABEL: Readonly<Record<ElementKind, string>> = {
  character: "Characters", place: "Places", object: "Objects", action: "Actions", emotion: "Emotions", theme: "Themes", sensation: "Sensations", dream_sign: "Dream signs",
};
export const KIND_ONE: Readonly<Record<ElementKind, string>> = {
  character: "Character", place: "Place", object: "Object", action: "Action", emotion: "Emotion", theme: "Theme", sensation: "Sensation", dream_sign: "Dream sign",
};
/** LaBerge's four categories (RESEARCH.md C1). */
export const CATEGORY_LABEL: Readonly<Record<SignCategory, string>> = { inner_awareness: "Inner awareness", action: "Action", form: "Form", context: "Context" };
export const dreamsText = (n: number) => (n === 1 ? "1 dream" : `${n} dreams`);

export function useSigns() {
  const j = useJournal();
  const today = useToday();
  const elements = computed(() => j.elements.data.value ?? []);
  const links = computed(() => j.links.data.value ?? []);
  const dreams = computed(() => j.dreams.data.value ?? []);
  const byId = computed(() => new Map(elements.value.map((e) => [e.id, e])));
  const stats = computed(() => elementStats(elements.value, links.value, dreams.value, today.value));
  return { j, today, elements, links, dreams, byId, stats };
}
