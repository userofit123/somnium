/// <reference types="vite/client" />
declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<object, object, unknown>;
  export default component;
}
declare module "virtual:ocr-eng" {
  /** The address of the bundled English OCR model, named eng.traineddata.gz (vite.config.ts ocrModel). */
  const url: string;
  export default url;
}
declare module "virtual:stt-model" {
  /** The speech model's folder and files (vite.config.ts sttModel): file name -> SHA-256, and their sizes in bytes.
   *  wasmDir: where the engine's WebAssembly is in development (null: in `dir` with the rest). glue: the engine's loader
   *  script, with the app's own files. null: built without it. */
  const model: { dir: string; wasmDir: string | null; glue: string; files: Record<string, string>; sizes: Record<string, number> } | null;
  export default model;
}
