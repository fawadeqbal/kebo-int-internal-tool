import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

// SWC keeps decorator metadata, which Nest's dependency injection needs (esbuild drops it).
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 20_000,
    // A file's setup starts the app and signs several people in: with coverage on (slower) that can pass 10 s.
    hookTimeout: 60_000,
    // COVERAGE=1 (CI's check job): how much of src/ the tests run, with a floor it may not drop under (what it
    // was when the floor was set, rounded down to the nearest 5: raise it as tests are added).
    coverage: {
      enabled: !!process.env.COVERAGE,
      provider: "v8",
      include: ["src/**"],
      reporter: ["text-summary", "json-summary"],
      reportOnFailure: true,
      thresholds: { lines: 90, functions: 90, branches: 75, statements: 85 },
    },
  },
  plugins: [swc.vite({ module: { type: "es6" } })],
});
