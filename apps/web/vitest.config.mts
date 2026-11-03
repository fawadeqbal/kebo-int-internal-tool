import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** Component tests (the design system's building blocks) in a browser-like DOM. */
export default defineConfig({
  // Next keeps JSX as written (tsconfig "preserve"); the tests compile it.
  oxc: { jsx: { runtime: "automatic" } },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.tsx"],
    setupFiles: ["test/setup.ts"],
  },
});
