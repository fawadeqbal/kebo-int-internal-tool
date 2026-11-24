import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** Component tests (the design system's building blocks) in a browser-like DOM. */
export default defineConfig({
  // Next keeps JSX as written (tsconfig "preserve"); the tests compile it.
  oxc: { jsx: { runtime: "automatic" } },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.{ts,tsx}"],
    setupFiles: ["test/setup.ts"],
    // COVERAGE=1 (CI's check job): how much of src/ the component tests run (the pages themselves are checked in
    // a browser by apps/web-e2e), with a floor it may not drop under.
    coverage: {
      enabled: !!process.env.COVERAGE,
      provider: "v8",
      include: ["src/**"],
      reporter: ["text-summary", "json-summary"],
      reportOnFailure: true,
      thresholds: { lines: 10, functions: 5, branches: 5, statements: 10 },
    },
  },
});
