<script setup lang="ts">
// The Appearance panel (ported from Money Manager): mode, colour set, background, texture, surface, corners, font,
// density, spacing, navigation, and saved looks. Styled by styles/components/appearance.css.
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from "vue";
import { theme, ATM, ST0, CP, AKEYS, BGS, FONTS, looks, lookFor, saveLooks, copy, isDark, atmOf, cpOf, custVal, lookPal, setTheme, themeSwap, PKEYS, type Theme } from "../core/theme";
import { appearanceOpen } from "../core/ui";
import { sheetOpened, sheetClosed } from "../core/sheets";
import { isPhone } from "../core/device";
import { lockScroll } from "../core/scrollLock";
import { usePullDown } from "../core/pullDown";
import { toast } from "../core/toast";
import AppSelect from "../components/AppSelect.vue";
import ColorPicker from "../components/ColorPicker.vue";

const tab = ref("col");
const TABS: Record<string, string> = { col: "Colours", bg: "Backdrop", sty: "Style", lay: "Layout", sav: "Saved" };
const k = computed<"L" | "D">(() => (isDark() ? "D" : "L"));
const dark = computed(() => k.value === "D");
const out = ref(false);
// Back closes it like any sheet, instead of leaving the page behind it
let backId = 0, unlock = () => {};
watch(appearanceOpen, (o) => {
  unlock();
  if (o) { backId = sheetOpened(() => (appearanceOpen.value = false)); if (isPhone.value) unlock = lockScroll(); } // phone only: a bottom sheet with a scrim; on a computer the lock would shift fixed elements by the scrollbar width
  else {
    unlock = () => {};
    if (backId) sheetClosed(backId); backId = 0;
    if (pull.pulledAway) return; // it already slid away under the finger
    out.value = true; setTimeout(() => (out.value = false), 200);
  }
});
const close = () => { appearanceOpen.value = false; };
const el = ref<HTMLElement | null>(null);
// on the phone it is a bottom sheet: pull it down to close, like the others
const pull = usePullDown(() => el.value, () => document.querySelector<HTMLElement>(".apscr"), () => appearanceOpen.value, close);
const outside = (e: Event) => { if (appearanceOpen.value && el.value && !el.value.contains(e.target as Node) && !(e.target as HTMLElement).closest?.("#themeBtn,[data-theme-open]")) close(); };
const esc = (e: KeyboardEvent) => { if (e.key === "Escape" && appearanceOpen.value) close(); };
onMounted(() => { document.addEventListener("click", outside, true); addEventListener("keydown", esc); });
onBeforeUnmount(() => { unlock(); document.removeEventListener("click", outside, true); removeEventListener("keydown", esc); });

const BGL: Record<string, string> = { glow: "Glow", mesh: "Mesh", diagonal: "Diagonal", spot: "Spotlight", aurora: "Aurora", horizon: "Horizon", duo: "Two-tone", corners: "Corner glow", sweep: "Sweep", flat: "Flat" };
const TEX: [string, string][] = [["none", "None"], ["dots", "Dots"], ["stripes", "Stripes"], ["grid", "Grid"], ["static", "Static"]];
const SURF: [string, string][] = [["solid", "Solid"], ["outline", "Outline"], ["raised", "Raised"], ["glass", "Glass"]];
const GLASS: [keyof Theme, string, number, number, number, number, string, string][] = [
  ["gbl", "Blur", 0, 100, 5, 50, "%", "How blurred the background looks through the blocks"],
  ["gsat", "Vibrance", 50, 250, 10, 140, "%", "How bright and colourful the background looks through the blocks"],
  ["gop", "Opacity", 0, 100, 5, 55, "%", "How solid the blocks are: 100% hides the background"],
];
const gval = (g: (typeof GLASS)[number]) => (theme[g[0]] == null ? g[5] : +(theme[g[0]] as number));
const RAD: [string, number, string][] = [["round", 18, "Round"], ["soft", 9, "Soft"], ["sharp", 2, "Sharp"]];
const FNT: [string, string][] = [["sans", "Sans"], ["serif", "Serif"], ["round", "Rounded"], ["mono", "Mono"]];
const DEN: [string, number, string][] = [["compact", 3, "Compact"], ["cozy", 6, "Cozy"], ["roomy", 10, "Roomy"]];
const SPC: [string, number, string][] = [["tight", 2, "Tight"], ["standard", 5, "Standard"], ["loose", 9, "Loose"], ["wide", 13, "Wide"]];
const NSP: [string, number, string][] = [["tight", 2, "Tight"], ["standard", 5, "Standard"], ["roomy", 8, "Roomy"]];
const CGROUPS: [string, string[]][] = [["Main colours", ["acc", "acc2", "accc"]], ["Text on the main colours", ["on", "onc"]], ["Page", ["bg", "tx"]], ["Better and worse", ["pos", "neg"]]];
const CNAME: Record<string, string> = { acc: "Accent", acc2: "Gradient colour", bg: "Background", tx: "Text", accc: "Accent tint", onc: "Text on tint", on: "Text on accent", pos: "Positive", neg: "Negative" };

const opt = (key: keyof Theme, v: unknown) => setTheme({ [key]: v } as Partial<Theme>);
const swatch = (n: string) => { const c = n === "Custom" ? atmOf("Custom")[k.value] : ATM[n]![k.value]; return `linear-gradient(135deg,${c[0]} 0 52%,${c[4]} 52% 100%)`; };
const range = (key: keyof Theme, v: string) => { (theme as any)[key] = +v; };
const fromPreset = (n: string) => {
  const a = ATM[n]; if (!a) return;
  const cu: Record<string, Record<string, string>> = { L: {}, D: {} };
  (["L", "D"] as const).forEach((m) => AKEYS.forEach((x, j) => { cu[m]![x] = a[m][j]!; }));
  setTheme({ cc: a.L[0], cu, cp: { L: {}, D: {} }, atm: "Custom" });
};
const setBase = (v: string) => Object.assign(theme, { cc: v, atm: "Custom", cu: { L: {}, D: {} }, cp: { L: {}, D: {} } });
const setCust = (n: string, v: string) => { const cu = copy(theme.cu || { L: {}, D: {} }); (cu[k.value] = cu[k.value] || {})[n] = v; Object.assign(theme, { cu, atm: "Custom" }); };
const setChart = (i: number, v: string) => { const cp = copy(theme.cp || { L: {}, D: {} }); (cp[k.value] = cp[k.value] || {})[i] = v; theme.cp = cp; };
const custReset = () => setTheme({ cu: { L: {}, D: {} }, cp: { L: {}, D: {} }, cc: ST0.cc });
const reset = () => themeSwap(() => { const keep = { ls: theme.ls }; Object.keys(theme).forEach((x) => delete (theme as any)[x]); Object.assign(theme, copy(ST0), keep); });

const lookName = ref(""), nameEl = ref<HTMLInputElement | null>(null);
const snap = () => copy(Object.fromEntries(PKEYS.map((x) => [x, theme[x]]))) as Partial<Theme>;
const openSave = () => { tab.value = "sav"; nextTick(() => nameEl.value?.focus()); };
function saveLook() {
  const nm = lookName.value.trim();
  if (!nm) { nameEl.value?.focus(); return; }
  if (looks.value.length >= 25) { toast("You can keep up to 25 looks. Delete one first.", { kind: "err" }); return; }
  looks.value = [...looks.value, { id: Date.now().toString(36), name: nm, v: snap() }];
  lookName.value = ""; saveLooks();
}
const useLook = (x: { v: Partial<Theme> }) => setTheme(copy(x.v));
function assign(x: { id: string }, sc: "L" | "D") {
  lookFor.value = { ...lookFor.value, [sc]: lookFor.value[sc] === x.id ? null : x.id }; saveLooks();
  const y = looks.value.find((z) => z.id === lookFor.value[sc]);
  if (y && (sc === "D") === isDark()) setTheme(copy(y.v));
}
const updLook = (x: { id: string; name: string }) => { looks.value = looks.value.map((y) => (y.id === x.id ? { ...y, v: snap() } : y)); saveLooks(); toast(`Saved “${x.name}” with the current look`); };
const delLook = (x: { id: string }) => { looks.value = looks.value.filter((y) => y.id !== x.id); const a = { ...lookFor.value }; (["L", "D"] as const).forEach((s) => { if (a[s] === x.id) a[s] = null; }); lookFor.value = a; saveLooks(); };
const lookDot = (x: { v: Partial<Theme> }) => { const c = lookPal(x.v, k.value); return `background:linear-gradient(135deg,${c[0]} 0 50%,${c[4]} 50% 100%);box-shadow:0 0 0 3px ${c[3]},0 0 0 4px var(--ol)`; };
</script>

<template>
  <!-- on the phone it's a bottom sheet over a scrim, like the other sheets; a tap on the scrim closes it -->
  <div v-if="isPhone && appearanceOpen" class="scr apscr" aria-hidden="true" />
  <div id="pop" ref="el" class="pop" :class="{ on: appearanceOpen, out }" role="dialog" aria-label="Appearance">
    <div class="aph"><b>Appearance</b><span class="aphb"><button class="btn o s" @click="openSave">Save…</button><button class="btn o s" @click="reset">Reset</button></span></div>
    <div id="apTabs" class="seg apseg aptabs">
      <button v-for="(l, x) in TABS" :key="x" :class="{ on: tab === x }" @click="tab = x">{{ l }}</button>
    </div>
    <div class="apb">
      <div class="apbt" :class="{ on: tab === 'col' }">
        <div class="aps"><h4>Mode</h4>
          <div class="seg apseg">
            <button :class="{ on: theme.mode === 'light' }" @click="opt('mode', 'light')">Light</button>
            <button :class="{ on: theme.mode === 'dark' }" @click="opt('mode', 'dark')">Dark</button>
            <button :class="{ on: theme.mode === 'auto' }" @click="opt('mode', 'auto')">Auto</button>
          </div>
        </div>
        <div class="aps"><h4>Colour palette</h4>
          <div class="sw">
            <button v-for="(_, n) in ATM" :key="n" :class="{ on: theme.atm === n }" :title="String(n)" @click="opt('atm', n)"><span class="swd" :style="{ background: swatch(String(n)) }" /><span class="swn">{{ n }}</span></button>
            <button :class="{ on: theme.atm === 'Custom' }" title="Custom colour" @click="opt('atm', 'Custom')"><span class="swd" :style="{ background: theme.atm === 'Custom' ? swatch('Custom') : 'conic-gradient(#f55,#fb3,#9d4,#3cb,#49f,#a6e,#f55)' }" /><span class="swn">Custom</span></button>
          </div>
        </div>
        <div v-if="theme.atm === 'Custom'" class="aps cust">
          <div class="cuh"><div><b>Your own colours</b><div class="sm">Pick one colour and the rest follow, or set each one yourself.</div></div><button class="btn o s" @click="custReset">Reset</button></div>
          <div class="cbase">
            <label class="cbc"><ColorPicker :model-value="theme.cc || '#954523'" title="Base colour" aria-label="Base colour" @update:model-value="setBase" /></label>
            <div class="cbt"><b>Base colour</b><span>{{ (theme.cc || "").toUpperCase() }}</span></div>
            <AppSelect model-value="" :options="Object.keys(ATM)" placeholder="Choose a preset…" title="Start from" aria-label="Start from" @update:model-value="fromPreset" />
          </div>
          <div class="cmode"><span class="cmd" :class="{ d: dark }" />{{ dark ? "Dark colours" : "Light colours" }}<span class="sm">Change Mode above to edit the other set.</span></div>
          <div v-for="[g, ns] in CGROUPS" :key="g" class="cgp">
            <h5>{{ g }}</h5>
            <div class="cgrid"><label v-for="n in ns" :key="n" class="crow"><ColorPicker :model-value="custVal(n, k)" :title="CNAME[n]" :aria-label="CNAME[n]" @update:model-value="(v) => setCust(n, v)" /><span>{{ CNAME[n] }}</span><output>{{ custVal(n, k).toUpperCase() }}</output></label></div>
          </div>
          <details class="cch fold"><summary>Chart colours</summary><div class="cchips"><label v-for="(_, i) in CP.L" :key="i" class="cchip" :title="`Chart colour ${i + 1}`"><ColorPicker :model-value="cpOf(k)[i]!" :title="`Chart colour ${i + 1}`" :aria-label="`Chart colour ${i + 1}`" @update:model-value="(v) => setChart(i, v)" /></label></div></details>
        </div>
      </div>
      <div class="apbt" :class="{ on: tab === 'bg' }">
        <div class="aps"><h4>Background</h4>
          <div class="apg c5"><button v-for="v in BGS" :key="v" class="apt" :class="{ on: theme.bg === v }" @click="opt('bg', v)"><span class="apv bgv" :class="'bg-' + v" /><span class="apl">{{ BGL[v] }}</span></button></div>
          <div class="apr" :class="{ off: theme.bg === 'flat' }"><span>Gradient strength</span><input type="range" min="0" max="200" step="5" :value="theme.gi ?? 100" @input="range('gi', ($event.target as HTMLInputElement).value)"><output>{{ Math.round(theme.gi ?? 100) }}%</output></div>
        </div>
        <div class="aps"><h4>Texture</h4>
          <div class="apg c5"><button v-for="[v, l] in TEX" :key="v" class="apt" :class="{ on: theme.tex === v }" @click="opt('tex', v)"><span class="apv txv" :class="'tx-' + v" /><span class="apl">{{ l }}</span></button></div>
          <div class="apsub" :class="{ off: theme.tex === 'none' }">
            <div class="apr"><span>Texture density</span><input type="range" min="40" max="240" step="10" :value="+theme.tsc || 100" @input="range('tsc', ($event.target as HTMLInputElement).value)"><output>{{ Math.round(+theme.tsc || 100) }}%</output></div>
            <div class="apr"><span>Texture opacity</span><input type="range" min="5" max="100" step="5" :value="theme.toa ?? 50" @input="range('toa', ($event.target as HTMLInputElement).value)"><output>{{ Math.round(theme.toa ?? 50) }}%</output></div>
          </div>
        </div>
      </div>
      <div class="apbt" :class="{ on: tab === 'sty' }">
        <div class="aps"><h4>Surface</h4>
          <div class="apg c5"><button v-for="[v, l] in SURF" :key="v" class="apt" :class="{ on: theme.surf === v }" @click="opt('surf', v)"><span class="apv sfv" :class="'sf-' + v"><i /></span><span class="apl">{{ l }}</span></button></div>
          <div v-if="theme.surf === 'glass'" class="apsub">
            <div v-for="g in GLASS" :key="g[0]" class="apr"><span :title="g[7]">{{ g[1] }}</span><input type="range" :min="g[2]" :max="g[3]" :step="g[4]" :value="gval(g)" @input="range(g[0], ($event.target as HTMLInputElement).value)"><output>{{ Math.round(gval(g)) }}{{ g[6] }}</output></div>
          </div>
        </div>
        <div class="aps"><h4>Corners</h4>
          <div class="apg"><button v-for="[v, r, l] in RAD" :key="v" class="apt" :class="{ on: theme.rad === v }" @click="opt('rad', v)"><span class="apv rv"><i :style="{ borderTopLeftRadius: r + 'px' }" /></span><span class="apl">{{ l }}</span></button></div>
        </div>
        <div class="aps"><h4>Font</h4>
          <div class="apg c4"><button v-for="[v, l] in FNT" :key="v" class="apt" :class="{ on: theme.fnt === v }" @click="opt('fnt', v)"><span class="apv fv" :style="{ fontFamily: FONTS[v] }">Aa</span><span class="apl">{{ l }}</span></button></div>
        </div>
      </div>
      <div class="apbt" :class="{ on: tab === 'lay' }">
        <div class="aps"><h4>Density</h4>
          <div class="apg"><button v-for="[v, g, l] in DEN" :key="v" class="apt" :class="{ on: theme.den === v }" @click="opt('den', v)"><span class="apv dv" :style="{ '--g': g + 'px' }"><i /><i /><i /></span><span class="apl">{{ l }}</span></button></div>
        </div>
        <div class="aps"><h4>Layout spacing</h4>
          <div class="apg c4"><button v-for="[v, g, l] in SPC" :key="v" class="apt" :class="{ on: theme.spc === v }" @click="opt('spc', v)"><span class="apv spv" :style="{ '--g': g + 'px' }"><i /><i /><i /></span><span class="apl">{{ l }}</span></button></div>
        </div>
        <div class="aps only-d"><h4>Sidebar spacing</h4>
          <div class="apg c3"><button v-for="[v, g, l] in NSP" :key="v" class="apt" :class="{ on: theme.nsp === v }" @click="opt('nsp', v)"><span class="apv spv sbv" :style="{ '--g': g + 'px' }"><i /><i /><i /><i /></span><span class="apl">{{ l }}</span></button></div>
        </div>
        <div class="aps only-d"><h4>Navigation</h4>
          <div class="seg apseg"><button :class="{ on: theme.nav === 'full' }" @click="opt('nav', 'full')">Labels</button><button :class="{ on: theme.nav === 'mini' }" @click="opt('nav', 'mini')">Icons only</button></div>
        </div>
      </div>
      <div class="apbt" :class="{ on: tab === 'sav' }">
        <div class="aps"><h4>Save current look</h4>
          <div class="apr" style="margin-top:0"><input ref="nameEl" v-model="lookName" type="text" maxlength="30" placeholder="Name" style="flex:1;min-width:0" @keydown.enter="saveLook"><button class="btn s" @click="saveLook">Save</button></div>
          <div class="sm" style="margin-top:8px">The mode (light, dark, auto) is not saved with a look.</div>
        </div>
        <div class="aps"><h4>Your looks</h4>
          <div id="tpList">
            <div v-for="x in looks" :key="x.id" class="tpr">
              <span class="tpd" :style="lookDot(x)" /><b>{{ x.name }}</b>
              <span class="tpa">
                <button class="btn o s" @click="useLook(x)">Use</button>
                <button class="btn o s" :class="{ on: lookFor.L === x.id }" title="Use in light mode" @click="assign(x, 'L')">Light</button>
                <button class="btn o s" :class="{ on: lookFor.D === x.id }" title="Use in dark mode" @click="assign(x, 'D')">Dark</button>
                <button class="btn o s" title="Replace with the current look" @click="updLook(x)">Update</button>
                <button class="btn o s" aria-label="Delete" @click="delLook(x)">×</button>
              </span>
            </div>
            <div v-if="!looks.length" class="sm">Nothing saved yet.</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
