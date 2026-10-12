import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  forbidOnly: true,
  outputDir: "e2e/out/results",
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { height: 800, width: 1280 },
      },
    },
  ],
  reporter: "list",
  retries: 0,
  testDir: "e2e",
  // `*.e2e.ts`, not `*.spec.ts`: the repo's lint gives every `*.spec.ts`
  // vitest's rules, and these are Playwright's tests.
  testMatch: "*.e2e.ts",
  timeout: 60_000,
});
