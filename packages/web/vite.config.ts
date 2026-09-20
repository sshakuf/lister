import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { shellWorker } from "./service-worker";

const target = process.env.LISTER_API ?? "http://127.0.0.1:7433";

export default defineConfig({
  plugins: [react(), {
    name: "lister-offline-shell",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      this.emitFile({type: "asset", fileName: "sw.js", source: shellWorker(Object.keys(bundle))});
    },
  }],
  server: {
    port: 5173,
    proxy: {
      "/api": { target, changeOrigin: true },
      "/ws": { target: target.replace(/^http/, "ws"), ws: true },
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
