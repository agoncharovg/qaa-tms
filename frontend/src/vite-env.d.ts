/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AGENT_PORTS?: string;
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
