import { defineConfig, devices } from "@playwright/test";

// Playwright E2E config for the redline Vite + React dev plugin.
// E2E specs live in the top-level `tests/e2e/` dir (owned by the fixture/e2e agents).
//
// TODO(fixture owner): finalize the `webServer.command` and `port`/`url` below.
// The exact command to boot the fixture playground dev server is TBD — it must
// start the Vite playground that mounts the redline plugin. The placeholder
// assumes a playground under `tests/fixtures/playground`. Adjust once the
// fixture is in place (e.g. switch to a pnpm workspace `--filter` invocation,
// or a dedicated `dev:fixture` script).

const PORT = 5173; // TODO(fixture owner): confirm/override the playground dev server port.
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: "tests/e2e",
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
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    // TODO(fixture owner): replace with the real command that boots the
    // fixture playground Vite dev server. Examples:
    //   command: "pnpm --filter @redline/playground dev"
    //   command: "vite tests/fixtures/playground"
    command: "vite tests/fixtures/playground --port " + PORT,
    url: baseURL,
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
});
