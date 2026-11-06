<script setup lang="ts">
// The app's own colour field, in place of <input type="color"> (whose picker is the system's): a swatch that opens a
// shade square, a hue slider and the hex code. Changes go out as you drag, as the browser's field did, so the
// theme follows live. The square's white and black are the colour space itself, not theme colours.
import { computed, ref } from "vue";
import { isPhone } from "../core/device";
import PickerPop from "./PickerPop.vue";

defineOptions({ inheritAttrs: false });
const props = defineProps<{ modelValue: string; title?: string }>();
const emit = defineEmits<{ "update:modelValue": [v: string] }>();

const hex2 = (n: number) => Math.round(n).toString(16).padStart(2, "0");
function toHsv(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim()); if (!m) return null;
  const n = parseInt(m[1]!, 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  const h = !d ? 0 : max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s: max ? d / max : 0, v: max };
}
function toHex(h: number, s: number, v: number) {
  const f = (k: number) => { const x = (k + h / 60) % 6; return v - v * s * Math.max(0, Math.min(x, 4 - x, 1)); };
  return "#" + hex2(f(5) * 255) + hex2(f(3) * 255) + hex2(f(1) * 255);
}

const open = ref(false), btn = ref<HTMLButtonElement | null>(null), area = ref<HTMLElement | null>(null);
// kept while it's open: a grey has no hue of its own, so working it out again from the hex would lose the slider's place
const hsv = ref({ h: 0, s: 0, v: 0 }), text = ref("");
const hueCss = computed(() => toHex(hsv.value.h, 1, 1));
function show() { hsv.value = toHsv(props.modelValue) ?? { h: 0, s: 0, v: 0 }; text.value = props.modelValue.toUpperCase(); open.value = true; }
function close(refocus = true) { open.value = false; if (refocus && !isPhone.value) btn.value?.focus({ preventScroll: true }); }
const esc = (e: KeyboardEvent) => { if (open.value) { e.stopPropagation(); close(); } };
function out() { const v = toHex(hsv.value.h, hsv.value.s, hsv.value.v); text.value = v.toUpperCase(); emit("update:modelValue", v); }

let drag = false;
function at(e: PointerEvent) {
  const r = area.value!.getBoundingClientRect();
  hsv.value.s = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  hsv.value.v = 1 - Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
  out();
}
const down = (e: PointerEvent) => { drag = true; area.value!.setPointerCapture(e.pointerId); at(e); };
const move = (e: PointerEvent) => { if (drag) at(e); };
// arrows move the spot in the square a little, with Shift a lot
function areaKey(e: KeyboardEvent) {
  const d = e.shiftKey ? .1 : .02, k: Record<string, [number, number]> = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, d], ArrowDown: [0, -d] };
  if (!k[e.key]) return;
  e.preventDefault();
  hsv.value.s = Math.min(1, Math.max(0, hsv.value.s + k[e.key]![0])); hsv.value.v = Math.min(1, Math.max(0, hsv.value.v + k[e.key]![1])); out();
}
function typed() { const c = toHsv(text.value); if (c) { hsv.value = c; emit("update:modelValue", toHex(c.h, c.s, c.v)); } }
</script>

<template>
  <button ref="btn" type="button" class="cpk" v-bind="$attrs" aria-haspopup="dialog" :aria-expanded="open" :style="{ background: modelValue }" @click="open ? close() : show()" @keydown.esc="esc" />
  <PickerPop v-if="open" :anchor="btn" :title="title ?? 'Colour'" @close="close(false)">
    <div class="cp" @keydown.esc.stop="close()">
      <div ref="area" class="sv" tabindex="0" role="slider" aria-label="Shade" :aria-valuetext="text" :style="{ background: hueCss }" @pointerdown="down" @pointermove="move" @pointerup="drag = false" @pointercancel="drag = false" @keydown="areaKey">
        <i :style="{ left: hsv.s * 100 + '%', top: (1 - hsv.v) * 100 + '%', background: toHex(hsv.h, hsv.s, hsv.v) }" />
      </div>
      <input v-model.number="hsv.h" class="hue" type="range" min="0" max="359" aria-label="Hue" @input="out" />
      <div class="hx"><span class="sw" :style="{ background: toHex(hsv.h, hsv.s, hsv.v) }" /><input v-model="text" class="in" maxlength="7" spellcheck="false" aria-label="Hex code" @input="typed" @keydown.enter="close()" /></div>
    </div>
  </PickerPop>
</template>

<style scoped>
.cpk { cursor: pointer; padding: 0; min-height: 0; }
.cp { width: 240px; display: flex; flex-direction: column; gap: 12px; padding: 4px; }
.sh_b .cp { width: auto; padding: 0 0 6px; }
.sv { position: relative; height: 150px; border-radius: var(--r-sm); touch-action: none; cursor: crosshair; outline-offset: 2px; }
.sh_b .sv { height: 200px; }
.sv::before { content: ""; position: absolute; inset: 0; border-radius: inherit; background: linear-gradient(0deg, #000, transparent), linear-gradient(90deg, #fff, transparent); }
.sv i { position: absolute; width: 16px; height: 16px; margin: -8px 0 0 -8px; border-radius: 50%; border: 2px solid var(--on); box-shadow: 0 0 0 1px var(--ol), var(--shadow-pop); pointer-events: none; }
.hue { width: 100%; height: 14px; min-height: 0; padding: 0; border: 0; border-radius: var(--pill); appearance: none; -webkit-appearance: none; cursor: pointer;
  background: linear-gradient(90deg, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00); }
.hue::-webkit-slider-thumb { -webkit-appearance: none; width: 18px; height: 18px; border-radius: 50%; background: var(--bg); border: 2px solid var(--tx); }
.hue::-moz-range-thumb { width: 14px; height: 14px; border-radius: 50%; background: var(--bg); border: 2px solid var(--tx); }
.hx { display: flex; gap: 8px; align-items: center; }
.hx .sw { width: 34px; height: 34px; border-radius: var(--r-sm); flex: none; box-shadow: inset 0 0 0 1px var(--ol); }
.hx input { flex: 1; font-variant-numeric: tabular-nums; text-transform: uppercase; }
</style>
