import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Client builds into ./public, which the Worker serves via the ASSETS binding.
// /api/* is handled by the Worker (see src/worker/index.ts); everything else is
// the SPA. In dev, `vite` proxies /api to `wrangler dev` on :8787.
export default defineConfig({
  root: "src/client",
  // Static assets (favicon, share image) copied verbatim into the build output.
  publicDir: "static",
  build: {
    outDir: "../../public",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/api": "http://localhost:8787",
    },
  },
});
