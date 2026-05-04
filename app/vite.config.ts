import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// Multi-page setup:
//   /        → public marketing landing (app/index.html, static)
//   /app     → admin React app (app/app/index.html, mounts main.tsx)
//   /otto/*  → static assets (sprites, glyphs, showcase, landing.html legacy)
export default defineConfig({
  plugins: [react()],
  appType: "mpa",
  build: {
    rollupOptions: {
      input: {
        landing: resolve(__dirname, "index.html"),
        admin: resolve(__dirname, "app/index.html"),
      },
    },
  },
});
