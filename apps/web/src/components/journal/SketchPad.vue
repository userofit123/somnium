<script setup lang="ts">
// A simple drawing of a dream scene (LDJ-20, optional feature "Sketches"): pen, eraser, undo, clear. Saved as a PNG
// through the same sealed upload as photos. The paper and ink are the theme's own colours at the moment of drawing.
import { onMounted, ref } from "vue";
import Icon from "../Icon.vue";
import Sheet from "../Sheet.vue";

const emit = defineEmits<{ save: [Blob]; close: [] }>();
const W = 1200, H = 900, UNDO = 30;
const cv = ref<HTMLCanvasElement | null>(null);
const tool = ref<"pen" | "eraser">("pen");
const undo: ImageData[] = [];
const canUndo = ref(false), drawn = ref(false), busy = ref(false);
let g: CanvasRenderingContext2D | null = null, paper = "", ink = "", last: { x: number; y: number } | null = null;

onMounted(() => {
  const c = cv.value!;
  c.width = W; c.height = H;
  g = c.getContext("2d", { willReadFrequently: true });
  const css = getComputedStyle(c);
  // resolved by the browser (the canvas's own background and colour come from --s1 and --tx), so any token form works
  paper = css.backgroundColor; ink = css.color;
  wipe();
});
function wipe() { if (!g) return; g.fillStyle = paper; g.fillRect(0, 0, W, H); }
function snapshot() { if (!g) return; undo.push(g.getImageData(0, 0, W, H)); if (undo.length > UNDO) undo.shift(); canUndo.value = true; }
const at = (e: PointerEvent) => { const r = cv.value!.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H }; };
function down(e: PointerEvent) {
  if (!g) return;
  cv.value!.setPointerCapture(e.pointerId);
  snapshot();
  last = at(e);
  line(last, last, e);
}
function move(e: PointerEvent) { if (!last || !g) return; const p = at(e); line(last, p, e); last = p; }
function up() { last = null; }
function line(a: { x: number; y: number }, b: { x: number; y: number }, e: PointerEvent) {
  const gg = g!;
  const press = e.pressure > 0 && e.pointerType === "pen" ? 0.5 + e.pressure : 1;
  gg.strokeStyle = tool.value === "pen" ? ink : paper;
  gg.lineWidth = (tool.value === "pen" ? 5 : 36) * press;
  gg.lineCap = "round"; gg.lineJoin = "round";
  gg.beginPath(); gg.moveTo(a.x, a.y); gg.lineTo(b.x, b.y); gg.stroke();
  drawn.value = true;
}
function back() { const s = undo.pop(); if (s && g) g.putImageData(s, 0, 0); canUndo.value = undo.length > 0; }
function clear() { snapshot(); wipe(); }
function save() {
  if (busy.value) return;
  busy.value = true;
  cv.value!.toBlob((b) => { busy.value = false; if (b) emit("save", b); }, "image/png");
}
</script>

<template>
  <Sheet title="Sketch" size="wide" @close="emit('close')">
    <div class="skbar">
      <div class="seg"><button :class="{ on: tool === 'pen' }" :aria-pressed="tool === 'pen'" @click="tool = 'pen'"><Icon name="edit" :size="14" />Pen</button><button :class="{ on: tool === 'eraser' }" :aria-pressed="tool === 'eraser'" @click="tool = 'eraser'">Eraser</button></div>
      <div class="grow" />
      <button class="qb" :disabled="!canUndo" @click="back"><Icon name="left" :size="14" />Undo</button>
      <button class="qb" @click="clear"><Icon name="trash" :size="14" />Clear</button>
    </div>
    <canvas ref="cv" class="skc" aria-label="Drawing area" @pointerdown.prevent="down" @pointermove.prevent="move" @pointerup="up" @pointercancel="up" @pointerleave="up" />
    <div class="skfoot"><button class="btn o" @click="emit('close')">Cancel</button><button class="btn" :disabled="!drawn || busy" @click="save">Save sketch</button></div>
  </Sheet>
</template>

<style scoped>
.skbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: var(--hg); }
.skbar .seg button { display: inline-flex; align-items: center; gap: 4px; }
.skc { display: block; width: 100%; aspect-ratio: 4 / 3; touch-action: none; border: 1px solid var(--ol); border-radius: var(--r); background: var(--s1); color: var(--tx); cursor: crosshair; }
.skfoot { display: flex; justify-content: flex-end; gap: 8px; margin-top: var(--hg); }
</style>
