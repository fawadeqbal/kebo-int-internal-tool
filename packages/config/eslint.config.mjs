import js from "@eslint/js";
import tseslint from "typescript-eslint";

/** Shared lint rules for every package and app. Apps extend this with framework rules. */
export default tseslint.config(
  { ignores: ["**/dist/**", "**/.next/**", "**/generated/**", "**/node_modules/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
);
