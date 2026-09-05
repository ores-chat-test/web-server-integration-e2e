import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["node_modules/**", "tmp/**", "temp/**"] },
  js.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      eqeqeq: "error",
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-var": "error",
      "prefer-const": "error",
    },
  },
];
