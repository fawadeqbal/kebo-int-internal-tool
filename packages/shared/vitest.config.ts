import { defineConfig } from "vitest/config";

// COVERAGE=1 (CI's check job): how much of src/ the tests run, with a floor it may not drop under (what it
// was when the floor was set, rounded down to the nearest 5: raise it as tests are added).
export default defineConfig({
  test: {
    coverage: {
      enabled: !!process.env.COVERAGE,
      provider: "v8",
      include: ["src/**"],
      reporter: ["text-summary", "json-summary"],
      reportOnFailure: true,
      thresholds: { lines: 75, functions: 55, branches: 55, statements: 75 },
    },
  },
});
