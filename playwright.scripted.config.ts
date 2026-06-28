import { defineConfig, devices } from "@playwright/test";

// E2E config for the SCRIPTED-agent suite (screenshot accuracy + mid-run
// switching — PR #30). Separate from playwright.config.ts because its webServer
// boots with `FORKDESIGN_E2E_SCRIPTED=1`, which gates every variant on a
// per-test barrier — that would hang the ordinary agent specs. Runs on its own
// port so both suites can coexist.
//
//   pnpm test:e2e:scripted

const PORT = Number(process.env.E2E_SCRIPTED_PORT ?? 5180);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: [
    "**/iteration-screenshots.test.ts",
    "**/refresh-behavior.test.ts",
  ],
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  reporter: isCI ? [["html", { open: "never" }], ["list"]] : "list",
  use: {
    baseURL,
    headless: true,
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
    command: `pnpm run build && pnpm exec vite --config tests/fixtures/playground/vite.config.ts --port ${PORT} --strictPort`,
    url: baseURL,
    // Gated, visibly-distinct agent + its test-only control endpoint.
    env: { FORKDESIGN_E2E_SCRIPTED: "1" },
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
});
