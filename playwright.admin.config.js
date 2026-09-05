import publicConfig from "./playwright.config.js";

// Separate configuration preserves public-suite behavior and immutable consumers.
// Neither target is configurable: synthetic credentials must never reach a live site.
export default {
  ...publicConfig,
  testDir: "./admin-tests",
  outputDir: "./tmp/admin-test-results",
  reporter: [
    ["list"],
    ["json", { outputFile: "./tmp/admin-browser-results.json" }],
  ],
  use: { ...publicConfig.use, baseURL: "http://127.0.0.1:4312" },
};
