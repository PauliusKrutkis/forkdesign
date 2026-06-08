import { defineConfig, devices } from "@playwright/test";

// Playwright E2E config for the redline Vite + React dev plugin.
// E2E specs live in the top-level `tests/e2e/` dir.
//
// The `webServer` below boots the fixture playground Vite dev server
// (`tests/fixtures/playground/`) with the redline plugin mounted from LOCAL
// SOURCE (no prior `pnpm build` required — see the playground vite.config.ts).
// The overlay only mounts under `import.meta.env.DEV`, which a Vite dev server
// satisfies.

const PORT = Number(process.env.E2E_PORT ?? 5179);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: "tests/e2e",
  // The specs share ONE on-disk fixture (tests/fixtures/playground/src/App.tsx)
  // that comment-creating tests mutate then restore, and one dev server. Running
  // them in parallel would let one test's afterEach-restore clobber another's
  // in-flight write. Force a single serial worker.
  fullyParallel: false,
  workers: 1,
  // Fail the build on CI if test.only was accidentally left in the source.
  forbidOnly: isCI,
  // Flaky-test mitigation: retry once on CI, never locally.
  retries: isCI ? 2 : 0,
  reporter: isCI ? [["html", { open: "never" }], ["list"]] : "list",
  use: {
    baseURL,
    headless: true,
    // Capture a trace only when retrying a failed test to keep artifacts small.
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `pnpm exec vite --config tests/fixtures/playground/vite.config.ts --port ${PORT} --strictPort`,
    url: baseURL,
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
});
