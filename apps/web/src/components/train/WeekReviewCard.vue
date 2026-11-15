<script setup lang="ts">
// The way into the weekly review (LDJ-155). On Train's Today tab it is there whenever the feature is on; on Home only
// on the review evening (the last day of the week in Settings, Formats, from 17:00) until it is done, as the "reminder":
// no notification, so nothing about the journal shows outside the app lock. Counts only, never dream text.
import { computed, onMounted, onUnmounted, ref } from "vue";
import { isReviewTime, resolveFormats, WEEK_REVIEW_HABIT } from "@somnium/shared";
import { useHabitLog } from "../../api/train";
import { useSettings } from "../../api/queries";
import { useToday } from "../../core/today";
import Icon from "../Icon.vue";

const props = defineProps<{ home?: boolean }>();
const settings = useSettings(), log = useHabitLog(), today = useToday();
const doneToday = computed(() => (log.data.value ?? []).some((r) => r.date === today.value && r.item === WEEK_REVIEW_HABIT && r.done));
// `today` changes at midnight; the hour is a ref checked every minute, so the card appears at 17:00 with Home left open
const hour = ref(new Date().getHours());
let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => { timer = setInterval(() => { hour.value = new Date().getHours(); }, 60_000); });
onUnmounted(() => clearInterval(timer));
const show = computed(() => !!settings.value.features.weekReview && (!props.home || (isReviewTime(today.value, hour.value, resolveFormats(settings.value).firstDay) && !doneToday.value)));
</script>

<template>
  <router-link v-if="show" to="/train/week" class="card li wrc">
    <Icon name="calendar" :size="20" class="muted" />
    <div class="grow"><div class="t">Weekly review</div><div class="s">{{ doneToday ? "Done for this week. Open it again any time." : "Two minutes: your week, and next week's WBTB nights and target sign." }}</div></div>
    <Icon name="right" :size="16" class="muted" />
  </router-link>
</template>

<style scoped>
.wrc { color: inherit; text-decoration: none; }
</style>
