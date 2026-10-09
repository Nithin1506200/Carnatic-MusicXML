import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { sites } from "./build/sites-vite-plugin.ts";

export default defineConfig({
  plugins: [react(), sites()],
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
    // The catalog and search index are fetched, never inlined, whatever
    // their size: keep them as hashed, immutable assets.
    assetsInlineLimit: (file) => (file.endsWith(".json") ? false : undefined),
  },
});
