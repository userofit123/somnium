<script setup lang="ts">
// Signs (PLAN.md §6.3, LDJ-19): the dream sign shortlist, elements by kind, suggestions and typical themes, worked
// out on this device from the journal as opened here. On a computer an element opens in a panel beside the list; on
// the phone it is a step of its own.
import { computed, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { loaded } from "../api/queries";
import { loadSignLexicons } from "../api/signs";
import { isPhone } from "../core/device";
import SignsOverview from "../components/signs/SignsOverview.vue";
import ElementPanel from "../components/signs/ElementPanel.vue";
import { useSigns } from "../components/signs/useSigns";

const route = useRoute(), router = useRouter();
const { j } = useSigns();
await loaded(j.elements, j.links, j.dreams);
onMounted(() => void loadSignLexicons());

const id = computed(() => (route.name === "signs-element" ? String(route.params.id ?? "") : ""));
const open = (eid: string) => (id.value ? router.replace : router.push)({ name: "signs-element", params: { id: eid } });
const close = () => (history.state?.back ? router.back() : router.replace("/signs"));
</script>

<template>
  <div class="page">
    <div v-if="isPhone && id" class="card"><ElementPanel :id="id" :key="id" back @close="close" @open="open" /></div>
    <div v-else class="sgcols" :class="{ split: !isPhone }">
      <div class="sglist">
        <div class="ph"><div><h1>Signs</h1><div class="sub">What keeps showing up in your dreams</div></div></div>
        <SignsOverview :selected="id || undefined" @open="open" />
      </div>
      <aside v-if="!isPhone" class="sgside">
        <div class="card">
          <ElementPanel v-if="id" :id="id" :key="id" @close="close" @open="open" />
          <div v-else class="empty sm">Pick a sign or an element to see its dreams here.</div>
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.sgcols.split { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: var(--spg); align-items: start; }
.sglist { min-width: 0; }
.sgside { position: sticky; top: var(--spg); min-width: 0; max-height: calc(100vh - 2 * var(--spg)); overflow-y: auto; }
</style>
