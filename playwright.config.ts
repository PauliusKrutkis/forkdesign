import { defineConfig, devices } from "@playwright/test";

// Playwright E2E config for the forkdesign Vite + React dev plugin.
// E2E specs live in the top-level `tests/e2e/` dir.
//
// The `webServer` below boots the fixture playground Vite dev server
// (`tests/fixtures/playground/`) with the forkdesign plugin mounted from LOCAL
// SOURCE (no prior `pnpm build` required — see the playground vite.config.ts).
// The overlay only mounts under `import.meta.env.DEV`, which a Vite dev server
// satisfies.

const PORT = Number(process.env.E2E_PORT ?? 5179);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: "tests/e2e",
  // Build the real shipped stylesheet (dist/styles.css) before anything starts,
  // so the playground loads the actual CSS instead of an empty stub. Runs before
  // `webServer`, which the aliased `forkdesign/styles.css` import depends on.
  globalSetup: "./tests/e2e/global-setup.ts",
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
    // Stub the agent so agent-mode specs are deterministic and never invoke the
    // real Claude/Cursor strategies. Read at the top of `runAgent`.
    env: { FORKDESIGN_E2E_STUB: "1" },
    // Locally we may reuse a server already on the port — if it was started
    // without FORKDESIGN_E2E_STUB, the agent specs would try the real agent.
    // Start fresh on CI; locally, stop any stale dev server before running.
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
});
