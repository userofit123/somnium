<script setup lang="ts">
// Typical dream themes (optional, LDJ-66; RESEARCH.md Part C §2.2, §2.4): how many of your dreams touch each of the
// 55 Typical Dreams Questionnaire themes, with the published figures beside them. Worked out on this device from the
// opened dream text and your theme elements (packages/shared/src/themes.ts); nothing is sent. The published figure is
// a lifetime "ever had it" share of people, so it is a sentence, not a second bar: the wording says what each number
// means rather than inviting a comparison the study does not support. Only shown while Settings → Features → Typical
// dream themes is on.
import { computed, ref, shallowRef } from "vue";
import { THEMES_MIN_DREAMS, THEMES_SOURCES, THEMES_TOP, typicalThemeRates, type NormTheme, type ThemeMatcher } from "@somnium/shared";
import { useJournal } from "../../api/journal";
import SourceSheet from "../learn/SourceSheet.vue";
import CiteChips from "../learn/CiteChips.vue";
import Icon from "../Icon.vue";
import ProgressBar from "../ProgressBar.vue";
import Sheet from "../Sheet.vue";
import "../../styles/components/learn.css";

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
// what the two numbers mean is long, so it sits behind the info button (LDJ-90)
const about = ref(false);
const pct = (share: number) => (share > 0 && share < 0.01 ? "under 1%" : `${Math.round(share * 100)}%`);
const dreamsText = (n: number) => (n === 1 ? "1 dream" : `${n} dreams`);
</script>

<template>
  <section data-testid="themescard">
    <div class="sh"><h2>Typical dream themes</h2><div class="row"><button v-if="result?.enough" type="button" class="lnk" :aria-pressed="all" @click="all = !all">{{ all ? "Only yours" : "All 55" }}</button><button v-if="result?.enough" class="ib sm plain" type="button" aria-label="About these shares" @click="about = true"><Icon name="info" :size="17" /></button></div></div>
    <div class="card">
      <div v-if="!result && failed" class="empty sm"><b>Not available</b>The theme list could not be loaded on this device. Reload the app to try again.</div>
      <div v-else-if="!result" class="empty sm"><b>Working it out</b>Reading your journal on this device.</div>
      <div v-else-if="!result.enough" class="empty sm"><b>Not enough yet</b>{{ dreamsText(result.read) }} so far. The shares show from {{ THEMES_MIN_DREAMS }} dreams on.</div>
      <template v-else>
        <p class="thsum">You have had {{ result.had }} of the 55 themes in {{ dreamsText(result.read) }} · {{ result.topHad }} of the {{ THEMES_TOP }} most common.</p>
        <div v-if="!shown.length" class="empty sm"><b>None found yet</b>None of the 55 themes is in your dreams so far.</div>
        <div v-else class="thlist">
          <div v-for="r in shown" :key="r.theme.id" class="throw" :class="{ few: !r.dreams }" :data-id="r.theme.id">
            <div class="t">{{ r.theme.displayName ?? r.theme.name }}</div>
            <div class="thbar"><ProgressBar :percent="r.share * 100" /><span class="num tiny">{{ pct(r.share) }}</span></div>
            <div class="tiny">{{ r.dreams ? `In ${dreamsText(r.dreams)} of yours` : "Not in your dreams yet" }} · {{ r.theme.prevalenceTotal }}% of students have ever had it (men {{ r.theme.prevalenceMen }}% · women {{ r.theme.prevalenceWomen }}%)</div>
            <div v-if="r.perDream" class="tiny">Per dream, like yours: {{ r.perDream.total }}% of dreams in the Hall and Van de Castle norms had any sexual content (men {{ r.perDream.men }}% · women {{ r.perDream.women }}%), from US students in the late 1940s.</div>
          </div>
        </div>
      </template>
      <div class="tiny ins-note">Sources: Nielsen and others 2003 · Schredl and others 2004 · Hall and Van de Castle norms <CiteChips :ids="THEMES_SOURCES" @cite="open = $event" /></div>
    </div>
    <Sheet v-if="about && result" title="Typical dream themes" @close="about = false"><p>The bar is the share of your dreams that touch the theme, found on this device from your words and the themes you added, {{ result.partial ? `over your newest ${dreamsText(result.read)} only: older ones aren't read here, so they are left out of the shares.` : "over your whole journal." }} The line under it is a different measure: the share of 1,181 Canadian students who said they had ever had the theme at some point in their life. A theme most people have had can still be in few of their dreams, so a share well under theirs is normal. What does compare is the order: the common themes are much the same from one group of people to the next.</p></Sheet>
    <SourceSheet v-if="open" :ids="open" @close="open = null" />
  </section>
</template>

<style scoped>
.thsum { margin: 0 0 calc(var(--hg) * .5); font-weight: 600; color: var(--tx); }
.thlist { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: calc(var(--hg) * 2); margin-top: calc(var(--hg) * .5); }
html.phone .thlist { grid-template-columns: minmax(0, 1fr); }
.throw { display: grid; gap: calc(var(--hg) * .25); padding-block: calc(var(--hg) * .5); border-top: 1px solid var(--ol); min-width: 0; }
.throw .t { font-weight: 600; color: var(--tx); }
.throw.few .t { color: var(--tx2); }
.thbar { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: calc(var(--hg) * .5); }
.thbar .num { color: var(--tx); min-width: 4ch; text-align: end; }
</style>
