import path from "node:path";

import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
    "process.env": "{}",
  },
  build: {
    cssCodeSplit: false,
    lib: {
      entry: path.resolve(__dirname, "./src/index.tsx"),
      fileName: () => "index.js",
      formats: ["es"],
    },
    outDir: "dist",
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
