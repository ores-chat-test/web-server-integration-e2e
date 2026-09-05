import { defineConfig, devices } from "@playwright/test";

// Deliberately not configurable: fault-injection requests must never reach a live site.
export default defineConfig({
  testDir: "./tests",
  outputDir: "./tmp/test-results",
  timeout: 30000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: [["list"], ["json", { outputFile: "./tmp/browser-results.json" }]],
  use: {
    baseURL: "http://127.0.0.1:4311",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    serviceWorkers: "block",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } },
    },
  ],
});
