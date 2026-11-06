<script setup lang="ts">
// Draws parsed Markdown blocks. Citations are tappable marks; they open the source in a sheet.
import type { Block } from "@somnium/knowledge/markdown";
import LearnInline from "./LearnInline.vue";
defineProps<{ blocks: Block[] }>();
const emit = defineEmits<{ cite: [ids: string[]] }>();
</script>

<template>
  <div class="lmd">
    <template v-for="(b, i) in blocks" :key="i">
      <component :is="'h' + b.level" v-if="b.t === 'heading'"><LearnInline :nodes="b.children" @cite="emit('cite', $event)" /></component>
      <p v-else-if="b.t === 'p'"><LearnInline :nodes="b.children" @cite="emit('cite', $event)" /></p>
      <ul v-else-if="b.t === 'ul'"><li v-for="(it, j) in b.items" :key="j"><LearnInline :nodes="it" @cite="emit('cite', $event)" /></li></ul>
      <ol v-else-if="b.t === 'ol'" :start="b.start"><li v-for="(it, j) in b.items" :key="j"><LearnInline :nodes="it" @cite="emit('cite', $event)" /></li></ol>
      <blockquote v-else-if="b.t === 'quote'"><LearnBlocks :blocks="b.blocks" @cite="emit('cite', $event)" /></blockquote>
      <div v-else class="tbl">
        <table>
          <thead><tr><th v-for="(h, j) in b.head" :key="j" :style="{ textAlign: b.align[j] ?? undefined }"><LearnInline :nodes="h" @cite="emit('cite', $event)" /></th></tr></thead>
          <tbody><tr v-for="(r, k) in b.rows" :key="k"><td v-for="(c, j) in r" :key="j" :style="{ textAlign: b.align[j] ?? undefined }"><LearnInline :nodes="c" @cite="emit('cite', $event)" /></td></tr></tbody>
        </table>
      </div>
    </template>
  </div>
</template>
