import { defineConfig } from "vite";
import nimiq from "@nimiq/core/vite";

export default defineConfig({
  plugins: [nimiq()],
  build: {
    target: "es2022",
    outDir: "dist",
  },
  server: {
    port: 5173,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    proxy: {
      "/api": "http://127.0.0.1:8799",
      "/ws": { target: "ws://127.0.0.1:8799", ws: true },
      "/health": "http://127.0.0.1:8799",
    },
  },
});
