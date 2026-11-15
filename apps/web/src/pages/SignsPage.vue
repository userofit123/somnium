<script setup lang="ts">
// Signs (PLAN.md §6.4, LDJ-19, LDJ-125): the dream sign shortlist, suggestions, typical themes and elements by kind, worked
// out on this device from the journal as opened here. On a computer an element opens in a panel beside the list; on
// the phone it is a step of its own.
import { computed, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { loaded } from "../api/queries";
import { finishMerges, loadSignLexicons } from "../api/signs";
import { isPhone } from "../core/device";
import Icon from "../components/Icon.vue";
import SignsOverview from "../components/signs/SignsOverview.vue";
import ElementPanel from "../components/signs/ElementPanel.vue";
import { useSigns } from "../components/signs/useSigns";

const route = useRoute(), router = useRouter();
const { j } = useSigns();
await loaded(j.elements, j.links, j.facts);
// a merge cut short last time is finished now (its element shows "Finishing a merge" meanwhile); offline it waits
onMounted(() => { void loadSignLexicons(); void finishMerges(j.elements.data.value ?? []).catch(() => {}); });

const id = computed(() => (route.name === "signs-element" ? String(route.params.id ?? "") : ""));
const open = (eid: string) => (id.value ? router.replace : router.push)({ name: "signs-element", params: { id: eid } });
const close = () => (history.state?.back ? router.back() : router.replace("/signs"));
</script>

<template>
  <div class="page">
    <ElementPanel v-if="isPhone && id" :id="id" :key="id" back @close="close" @open="open" />
    <template v-else>
    <!-- the header spans the page above the list and the open element, as on Journal and Motus's pages -->
    <div class="ph"><div><h1>Dream signs</h1><div class="sub">Elements are the people, places, things and feelings in your dreams. Dream signs are the ones that keep coming back, your cue to check whether you are dreaming.</div></div></div>
    <div :class="{ split: !isPhone }">
      <div>
        <SignsOverview :selected="id || undefined" @open="open" />
      </div>
      <aside v-if="!isPhone" class="side">
        <div class="card">
          <ElementPanel v-if="id" :id="id" :key="id" @close="close" @open="open" />
          <div v-else class="empty sm"><Icon name="sparkle" :size="34" /><b>No sign open</b>Pick a sign or an element to see its dreams here.</div>
        </div>
      </aside>
    </div>
    </template>
  </div>
</template>
