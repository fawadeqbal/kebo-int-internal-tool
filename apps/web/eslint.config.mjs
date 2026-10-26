import base from "@kebo/config/eslint";
import nextPlugin from "@next/eslint-plugin-next";
import reactHooks from "eslint-plugin-react-hooks";

/** The shared rules plus React's hook rules and Next's own (the code already refers to both). */
export default [
  ...base,
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks, "@next/next": nextPlugin },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...nextPlugin.configs.recommended.rules,
      // `catch {}` is how optional browser APIs (localStorage) are tried.
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
];
