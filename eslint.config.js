const js = require("@eslint/js");
const globals = require("globals");

module.exports = [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: {
        ...globals.node,
      },
    },
    rules: {
      "no-console": "off",
      "no-unused-vars": ["error", {
        argsIgnorePattern: "^_|^next$|^req$|^res$",
      }],
      "prefer-const": "error",
      "no-var": "error",
      "eqeqeq": "error",
    },
  },
  {
    files: ["tests/**/*.js"],
    languageOptions: {
      globals: {
        ...globals.jest,
      },
    },
  },
  {
    ignores: [
      "node_modules/",
      "hackernews-frontend/",
      "scripts/",
      "coverage/",
    ],
  },
];
