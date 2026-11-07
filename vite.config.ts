import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import process from "node:process";

const host = process.env.TAURI_DEV_HOST;

/** Node-only packages — must never enter the browser / Tauri webview bundle. */
const NODE_ONLY = [
  "@cline/core",
  "@cline/sdk",
  "@cline/shared",
  "@cline/llms",
  "@opentelemetry/api",
  "@opentelemetry/sdk-node",
  "@opentelemetry/sdk-trace-base",
  "@opentelemetry/resources",
  "@opentelemetry/core",
];

export default defineConfig(() => ({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  optimizeDeps: {
    // Keep Tauri HTTP in the client graph; never exclude it.
    include: ["@tauri-apps/plugin-http", "@tauri-apps/api"],
    exclude: [...NODE_ONLY, "@opentelemetry/api-logs", "@opentelemetry/sdk-logs"],
  },
  ssr: {
    noExternal: [],
    external: [...NODE_ONLY],
  },
  build: {
    rollupOptions: {
      // Do NOT externalize @tauri-apps/plugin-http
      external: [...NODE_ONLY],
    },
  },
  resolve: {
    dedupe: ["@tauri-apps/api", "@tauri-apps/plugin-http"],
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "sidecar/**/*.test.mjs"],
    // Vitest runs in Node — allow resolving @cline/* for Phase 0 tests.
    server: {
      deps: {
        external: [],
      },
    },
  },
}));
