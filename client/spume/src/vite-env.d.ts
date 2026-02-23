/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Set to "true" when running in Tauri app context */
  readonly VITE_TAURI_MODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
