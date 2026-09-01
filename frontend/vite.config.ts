import path from "node:path";

import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@qaa-tms/plugin-sdk": path.resolve(__dirname, "../sdk/src/index.ts"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 3000,
  },
  test: {
    css: true,
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test/setup.ts",
  },
});
