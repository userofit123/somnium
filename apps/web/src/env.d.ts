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
