<script setup lang="ts">
import Icon from "../Icon.vue";
// Typical dream themes (optional, LDJ-66; RESEARCH.md Part C §2.2, §2.4): how many of your dreams touch each of the
// 55 Typical Dreams Questionnaire themes, with the published figures beside them. Worked out on this device from the
// opened dream text and your theme elements (packages/shared/src/themes.ts); nothing is sent. The published figure is
// a lifetime "ever had it" share of people, so it is a sentence, not a second bar: the wording says what each number
// means rather than inviting a comparison the study does not support. Only shown while Settings → Features → Typical
// dream themes is on. Its one home is Dream signs (PLAN.md §6.4, LDJ-124): a theme you have as an element opens it.
import { computed, ref, shallowRef } from "vue";
import { THEMES_MIN_DREAMS, THEMES_SOURCES, THEMES_TOP, typicalThemeRates, type NormTheme, type ThemeMatcher } from "@somnium/shared";
import { useJournal } from "../../api/journal";
import SourceSheet from "../learn/SourceSheet.vue";
import CiteChips from "../learn/CiteChips.vue";
import ProgressBar from "../ProgressBar.vue";
import ChartInfo from "../insights/ChartInfo.vue";
import "../../styles/components/learn.css";

/** theme id -> the element standing for it (signs.ts themeComparison), so its row opens that element */
const props = defineProps<{ elements?: ReadonlyMap<string, string> }>();
const emit = defineEmits<{ open: [id: string] }>();
const j = useJournal();
// the lexicon is loaded on first use, as the editor's detection does (components/journal/detect.ts)
const lex = shallowRef<{ themes: readonly NormTheme[]; match: ThemeMatcher } | null>(null);
// if the lexicon cannot load (an old cached build, a broken chunk) the card says so instead of "Working it out" for ever
const failed = ref(false);
import("@somnium/knowledge/lexicons").then((l) => { lex.value = { themes: l.themes, match: { matchLexicon: l.matchLexicon, stem: l.stem } }; }).catch(() => { failed.value = true; });

const result = computed(() => {
  const facts = j.facts.data.value, dreams = j.dreams.data.value, elements = j.elements.data.value, links = j.links.data.value;
  if (!lex.value || !facts || !dreams || !elements || !links) return null;
  // the shares are of the dreams whose words are open on this device (the newest DREAM_LIMIT), not of every fact
  return typicalThemeRates(facts.map((f) => f.id), dreams, elements, links, lex.value.themes, lex.value.match);
});
const all = ref(false);
const shown = computed(() => {
  const rows = result.value?.rows ?? [];
  return all.value ? rows : rows.filter((r) => r.dreams > 0).sort((a, b) => b.dreams - a.dreams || a.rank - b.rank);
});
const open = ref<string[] | null>(null);
const pct = (share: number) => (share > 0 && share < 0.01 ? "under 1%" : `${Math.round(share * 100)}%`);
const dreamsText = (n: number) => (n === 1 ? "1 dream" : `${n} dreams`);
const reload = () => location.reload();
</script>

<template>
  <section data-testid="themescard">
    <div class="card">
      <div class="lbl hgap"><span class="bi"><Icon name="layers" :size="16" /></span><span class="grow">Typical dream themes</span><button v-if="result?.enough" type="button" class="lnk" :aria-pressed="all" @click="all = !all">{{ all ? "Only yours" : "All 55" }}</button><ChartInfo id="themes" /></div>
      <div v-if="!result && failed" class="empty sm"><b>Not available</b>The theme list could not be loaded on this device.<br /><button class="btn tonal" type="button" @click="reload">Reload the app</button></div>
      <div v-else-if="!result" class="empty sm"><b>Working it out</b>Reading your journal on this device.</div>
      <div v-else-if="!result.enough" class="empty sm"><b>Not enough yet</b>{{ dreamsText(result.read) }} so far. The shares show from {{ THEMES_MIN_DREAMS }} dreams on.</div>
      <template v-else>
        <p class="thsum">You have had {{ result.had }} of the 55 themes in {{ dreamsText(result.read) }} · {{ result.topHad }} of the {{ THEMES_TOP }} most common.</p>
        <div v-if="!shown.length" class="empty sm"><b>None found yet</b>None of the 55 themes is in your dreams so far.</div>
        <div v-else class="thlist">
          <component :is="props.elements?.get(r.theme.id) ? 'button' : 'div'" v-for="r in shown" :key="r.theme.id" :type="props.elements?.get(r.theme.id) ? 'button' : undefined" class="throw" :class="{ few: !r.dreams, click: props.elements?.has(r.theme.id) }" :data-id="r.theme.id" @click="props.elements?.get(r.theme.id) && emit('open', props.elements.get(r.theme.id)!)">
            <div class="t">{{ r.theme.displayName ?? r.theme.name }}</div>
            <div class="thbar"><ProgressBar :percent="r.share * 100" /><span class="num tiny">{{ pct(r.share) }}</span></div>
            <div class="tiny">{{ r.dreams ? `In ${dreamsText(r.dreams)} of yours` : "Not in your dreams yet" }} · {{ r.theme.prevalenceTotal }}% of students have ever had it (men {{ r.theme.prevalenceMen }}% · women {{ r.theme.prevalenceWomen }}%)</div>
            <div v-if="r.perDream" class="tiny">Per dream, like yours: {{ r.perDream.total }}% of dreams in the Hall and Van de Castle norms had any sexual content (men {{ r.perDream.men }}% · women {{ r.perDream.women }}%), from US students in the late 1940s.</div>
          </component>
        </div>
      </template>
      <div class="tiny ins-note">Sources: Nielsen and others 2003 · Schredl and others 2004 · Hall and Van de Castle norms <CiteChips :ids="THEMES_SOURCES" @cite="open = $event" /></div>
    </div>
    <SourceSheet v-if="open" :ids="open" @close="open = null" />
  </section>
</template>

<style scoped>
.thsum { margin: 0 0 var(--tdy); font-weight: 600; color: var(--tx); }
/* two columns when the list has the room, one beside an open element and on a phone */
.thlist { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 18rem), 1fr)); column-gap: calc(var(--lpy) * 2); margin-top: var(--tdy); }
.throw { display: grid; gap: calc(var(--lpy) * .25); padding-block: var(--tdy); border-top: 1px solid var(--ol); min-width: 0; }
button.throw { font: inherit; color: inherit; background: none; border: 0; border-top: 1px solid var(--ol); text-align: start; cursor: pointer; width: 100%; }
.throw .t { font-weight: 600; color: var(--tx); }
.throw.few .t { color: var(--tx2); }
.thbar { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: var(--tdy); }
.thbar .num { color: var(--tx); min-width: 4ch; text-align: end; }
</style>
