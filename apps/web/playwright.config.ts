import { defineConfig, devices } from "@playwright/test";

/**
 * The Playwright check of a deployed web (issue 806), never part of verify:
 * vitest runs only `test/`, and this runs only `e2e/*.e2e.ts`, against the stage
 * `WEB_URL` names (the spec skips itself without one). From `apps/web`:
 *
 *   bunx playwright install chromium
 *   WEB_URL=https://web-dev-oscabriel.oscargabriel.workers.dev bun run e2e
 *
 * Each page's screenshot lands in `e2e/out/` (gitignored), for the shot
 * list; Playwright's own traces and failures go to `e2e/out/results/`.
 */
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
