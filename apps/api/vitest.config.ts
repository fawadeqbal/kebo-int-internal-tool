import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

// SWC keeps decorator metadata, which Nest's dependency injection needs (esbuild drops it).
export default defineConfig({
  test: { include: ["test/**/*.test.ts"], fileParallelism: false, testTimeout: 20_000 },
  plugins: [swc.vite({ module: { type: "es6" } })],
});
