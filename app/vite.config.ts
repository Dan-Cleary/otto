import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// Multi-page setup:
//   /            → public marketing landing (app/index.html, static)
//   /dashboard   → admin React app (app/dashboard/index.html, mounts main.tsx)
//   /404         → static "page not found" page (app/404.html). Vercel
//                  serves this automatically when no other route matches.
//   /otto/*      → static assets (sprites, glyphs, showcase, landing.html legacy)
export default defineConfig({
  plugins: [react()],
  appType: "mpa",
  build: {
    rollupOptions: {
      input: {
        landing: resolve(__dirname, "index.html"),
        admin: resolve(__dirname, "dashboard/index.html"),
        login: resolve(__dirname, "login.html"),
        signup: resolve(__dirname, "signup.html"),
        notFound: resolve(__dirname, "404.html"),
        docsInstall: resolve(__dirname, "docs/install.html"),
      },
    },
  },
});
