/**
 * STUB — dedicated vitest config for the opt-in real-agent eval suite.
 *
 * Kept SEPARATE from the root vitest.config.ts on purpose: the eval suite must
 * never be discovered by `pnpm test` (unit) or `pnpm test:integration`. Run it
 * explicitly:
 *   TODO(tier2): add a package.json script, e.g.
 *     "test:agent-eval": "vitest run --config tests/agent-eval/vitest.config.ts"
 *   and document ANTHROPIC_API_KEY as required (the specs self-skip without it).
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "agent-eval",
    // Node env: drives the real server + agent seam (no DOM).
    environment: "node",
    include: ["tests/agent-eval/**/*.test.ts"],
    // Real agent calls are slow and rate-limited — be patient, serial, no retry.
    testTimeout: 300_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    retry: 0,
    // TODO(tier2): consider a reporter that emits the judge-score trend artifact.
  },
});
