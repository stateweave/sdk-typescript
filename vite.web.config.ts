import { defineConfig } from "vite";

const webBasePath = process.env.STATEWEAVE_WEB_BASE_PATH ?? "/";
const apiPort = process.env.STATEWEAVE_WEB_API_PORT ?? process.env.PORT ?? "3000";

export default defineConfig({
  root: "web",
  base: webBasePath,
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/api": `http://127.0.0.1:${apiPort}`
    }
  },
  preview: {
    host: "0.0.0.0",
    port: 4173
  },
  build: {
    outDir: "../dist-web",
    emptyOutDir: true
  }
});
