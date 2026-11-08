import { defineConfig } from "vite";

export default defineConfig({
  root: "web",
  envDir: false,
  base: process.env.STATEWEAVE_WEB_BASE_PATH ?? "/",
  server: {
    host: "127.0.0.1",
    port: 5173
  },
  preview: {
    host: "127.0.0.1",
    port: 4173
  },
  build: {
    outDir: "../dist-web",
    emptyOutDir: true
  }
});
