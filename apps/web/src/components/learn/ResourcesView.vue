<script setup lang="ts">
// Resources: books, key studies, organisations, websites and communities, all taken from RESEARCH.md's reference lists.
// Links are the addresses written in those references. Nothing is ranked or marked as recommended.
import { ref } from "vue";
import { sources } from "@somnium/knowledge/content";
import { resolveResources } from "@somnium/knowledge/resources";
import SourceSheet from "./SourceSheet.vue";
const groups = resolveResources(sources);
const open = ref<string[] | null>(null);
</script>

<template>
  <div class="art wide">
    <h1>Resources</h1>
    <p class="lede">Books, studies, organisations and communities behind the Learn articles. Each one comes from the reference lists in the research notes; none is ranked.</p>
    <template v-for="g in groups" :key="g.id">
      <h2 class="sh">{{ g.title }}</h2>
      <div class="card flush">
        <div v-for="r in g.items" :key="r.title" class="li rsrc">
          <div class="grow">
            <div class="t">{{ r.title }}</div>
            <div class="s">{{ r.by }}</div>
            <div v-if="r.note" class="s rnote">{{ r.note }}</div>
            <div class="s rlinks">
              <button type="button" class="cite" :aria-label="'Source ' + r.src.join(', ')" @click="open = r.src">{{ r.src.join(", ") }}</button>
              <a v-if="r.link" :href="r.link" target="_blank" rel="noopener noreferrer" class="srcurl">Open link</a>
            </div>
          </div>
        </div>
      </div>
    </template>
    <SourceSheet v-if="open" :ids="open" @close="open = null" />
  </div>
</template>
