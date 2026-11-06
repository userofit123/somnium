<script setup lang="ts">
// "This morning" (PLAN.md §6.1): one primary button to write last night's dream, and a quiet "No recall", until the
// night has a dream or the mark; then its summary. Titles only: Home never shows dream text.
import { computed } from "vue";
import { useRouter } from "vue-router";
import { morningLine, type MorningState } from "@somnium/shared";
import { markNoRecall, uuidv7 } from "../../api/journal";
import { useChange } from "../../api/queries";
import Icon from "../Icon.vue";

const props = defineProps<{ state: MorningState; date: string }>();
const router = useRouter();
const line = computed(() => morningLine(props.state));
const write = () => router.push({ name: "journal-write", params: { id: uuidv7() }, query: { new: "1", date: props.date } });
const noRecall = useChange(() => markNoRecall(props.date), ["journal", "home"]);
</script>

<template>
  <section class="hmorning">
    <div class="sh"><h2>This morning</h2></div>
    <div v-if="state.kind === 'open'" class="card hwrite">
      <div class="tiny">Write it down before it fades - even a fragment counts.</div>
      <button class="btn lg" @click="write"><Icon name="plus" :size="18" />Write last night's dream</button>
      <button type="button" class="lnk inl tiny" :disabled="noRecall.busy.value" @click="noRecall.run()">No recall</button>
    </div>
    <div v-else class="card">
      <div class="hsum">
        <Icon name="moon" :size="18" />
        <div class="grow"><div class="t">Last night</div><div class="tiny">{{ line }}</div></div>
        <span v-if="state.kind === 'logged' && state.nightmare" class="hmark">Nightmare</span>
        <span v-else-if="state.kind === 'logged' && state.lucid" class="hmark acc">Lucid</span>
      </div>
      <div v-if="state.kind === 'logged' && state.titled.length" class="htitles">
        <router-link v-for="d in state.titled" :key="d.id" :to="{ name: 'journal-dream', params: { id: d.id } }" class="tiny">{{ d.title }}</router-link>
      </div>
      <div class="hfoot"><router-link to="/journal" class="lnk inl tiny">Open the Journal</router-link><button type="button" class="lnk inl tiny" @click="write">Add another dream</button></div>
    </div>
  </section>
</template>
