import { defineConfig } from "vitest/config";

// Test layers are split into two Vitest projects:
//   - `unit`:        fast component/logic tests colocated in `src/` (happy-dom).
//   - `integration`: slower cross-module tests in the top-level `tests/` dir (node env).
// The default `vitest run` (used by `pnpm test`) runs ALL projects, but CI keeps
// integration scoped to its own non-blocking job via `pnpm test:integration`
// (see package.json) so we filter to the `unit` project below when no project is
// selected — `pnpm test` => unit only; `pnpm test:integration` => integration only.
export default defineConfig({
  test: {
    projects: [
      {
        // Unit tests: default fast suite, DOM environment, colocated in src/.
        test: {
          name: "unit",
          environment: "happy-dom",
          include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
        },
      },
      {
        // Integration tests: live in the separate top-level tests/ dir, node env.
        // Run via `pnpm test:integration` (vitest --project integration).
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
        },
      },
    ],
  },
});
