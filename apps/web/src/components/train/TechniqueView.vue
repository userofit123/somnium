<script setup lang="ts">
// One technique (LDJ-23): its Learn article rendered with the same renderer and source sheet, the evidence badge and
// where it comes from, the safety note where it applies, and the screen's one primary button: "Use tonight".
import { computed, ref } from "vue";
import { articles, sources } from "@somnium/knowledge/content";
import { parseMarkdown, parseInline } from "@somnium/knowledge/markdown";
import { families, evidenceLabel, type Technique } from "@somnium/knowledge/techniques";
import LearnBlocks from "../learn/LearnBlocks.vue";
import LearnInline from "../learn/LearnInline.vue";
import SourceSheet from "../learn/SourceSheet.vue";
import SafetyNote from "./SafetyNote.vue";
import Icon from "../Icon.vue";
import { planTonight } from "../../api/train";
import { useChange } from "../../api/queries";
import { toast } from "../../core/toast";

const props = defineProps<{ technique: Technique; planned: boolean }>();
const article = computed(() => articles.find((a) => a.id === "techniques/" + props.technique.slug)!);
const blocks = computed(() => parseMarkdown(article.value.body));
const basis = computed(() => parseInline(props.technique.basis));
const family = computed(() => families.find((f) => f.id === props.technique.family)?.title ?? "");
const listed = computed(() => article.value.sources.filter((id) => sources.has(id)));
const open = ref<string[] | null>(null);
const showSources = ref(false);
const plan = useChange((add: boolean) => planTonight(props.technique.id, add), ["journal", "train"]);
async function use(add: boolean) {
  // a failed save already shows its error (useChange's onError); the confirmation is only for a save that landed
  try { await plan.run(add); } catch { return; }
  toast(add ? "Added to tonight's plan" : "Removed from tonight's plan");
}
</script>

<template>
  <article class="art tview">
    <router-link to="/train" class="lback"><Icon name="left" /> Train</router-link>
    <div class="eyebrow">{{ family }}</div>
    <h1>{{ article.title }}</h1>
    <p class="lede">{{ article.summary }}</p>
    <div class="tuse card">
      <div class="grow">
        <span class="tev" :class="technique.evidence">{{ evidenceLabel[technique.evidence] }}</span>
        <div class="tiny tbasis"><LearnInline :nodes="basis" @cite="open = $event" /></div>
      </div>
      <button v-if="!planned" class="btn" :disabled="plan.busy.value" @click="use(true)">Use tonight</button>
      <div v-else class="tplanned"><span class="tiny"><Icon name="check" :size="14" /> In tonight's plan</span><button class="lnk inl" :disabled="plan.busy.value" @click="use(false)">Remove</button></div>
    </div>
    <SafetyNote v-if="technique.safety" @cite="open = $event" />
    <LearnBlocks :blocks="blocks" @cite="open = $event" />
    <section class="srcs">
      <button type="button" class="srch" :aria-expanded="showSources" @click="showSources = !showSources">
        Sources ({{ listed.length }}) <span class="s">· reviewed {{ article.reviewed }}</span>
      </button>
      <ul v-if="showSources">
        <li v-for="id in listed" :key="id"><button type="button" class="cite" @click="open = [id]">{{ id }}</button> <span class="s">{{ sources.get(id)?.text.replace(/https?:\/\/\S+/, "").trim() }}</span></li>
      </ul>
    </section>
    <SourceSheet v-if="open" :ids="open" @close="open = null" />
  </article>
</template>
