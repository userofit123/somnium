<script setup lang="ts">
// "From your journal" (LDJ-161): one past dream a day on Home, so you re-read it and notice your dream signs. The pick is
// pure (packages/shared/src/home.ts pastDream); Home shows its title, date and why it came back, never a word of the
// dream itself. "Re-read" opens the dream; "Not now" puts it away until tomorrow (pastDream.ts).
import { ref } from "vue";
import { useRouter } from "vue-router";
import { PAST_DREAM_SOURCES } from "@somnium/shared";
import { useFmt } from "../../core/format";
import CiteChips from "../learn/CiteChips.vue";
import SourceSheet from "../learn/SourceSheet.vue";
import "../../styles/components/learn.css";

const props = defineProps<{ past: { id: string; date: string; title: string; why: string } }>();
defineEmits<{ notNow: [] }>();
const fmt = useFmt();
const router = useRouter();
const reread = () => router.push({ name: "journal-dream", params: { id: props.past.id } });
const open = ref<string[] | null>(null);
</script>

<template>
  <section class="hextra">
    <div class="sh"><h2>From your journal</h2></div>
    <div class="card hpast">
      <router-link :to="{ name: 'journal-dream', params: { id: past.id } }" class="hcard">
        <div class="t">{{ past.title }}</div>
        <div class="tiny">{{ fmt.date(past.date, { day: "numeric", month: "long", year: "numeric" }) }} · {{ past.why }}</div>
      </router-link>
      <p class="tiny muted">Re-reading old dreams is how you spot your dream signs. <CiteChips :ids="PAST_DREAM_SOURCES" @cite="open = $event" /></p>
      <div class="hkey-acts">
        <button class="qb" type="button" @click="$emit('notNow')">Not now</button>
        <button class="qb acc" type="button" @click="reread">Re-read</button>
      </div>
    </div>
    <SourceSheet v-if="open" :ids="open" @close="open = null" />
  </section>
</template>
