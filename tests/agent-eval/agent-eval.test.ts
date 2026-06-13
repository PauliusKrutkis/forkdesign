/**
 * STUB — Tier 2 real-agent eval entrypoint.
 *
 * GATING (two independent guards so this never runs by accident):
 *   1. This file is OUTSIDE both vitest project `include` globs in
 *      vitest.config.ts (`src/**` and `tests/integration/**`), so neither
 *      `pnpm test` nor `pnpm test:integration` discovers it. It only runs under
 *      the dedicated tests/agent-eval/vitest.config.ts (TODO: wire a
 *      `test:agent-eval` script).
 *   2. `describe.skipIf(!ANTHROPIC_API_KEY)` — even under its own config it
 *      no-ops without credentials, so CI (which has none) is safe.
 *
 * This is NOT a pass/fail gate on quality. Invariants may assert hard; judge
 * scores are logged/persisted as a trend (see harness.ts / judge.ts).
 */

import { describe, expect, it } from "vitest";
import { runScenario } from "./harness.ts";
import { SCENARIOS } from "./scenarios.ts";

const HAS_KEY = Boolean(process.env.ANTHROPIC_API_KEY);

describe.skipIf(!HAS_KEY)("agent eval (REAL agent — opt-in)", () => {
  // TODO(tier2): once SCENARIOS is populated, iterate it. Empty for now so the
  // suite is inert even with a key present.
  for (const scenario of SCENARIOS) {
    // TODO(tier2): real agent runs are slow — the 300s timeout is generous on
    // purpose; tune once runScenario is implemented.
    it(scenario.description, async () => {
      const report = await runScenario(scenario);

      // Objective invariants: hard assertions.
      for (const inv of report.invariants) {
        expect(inv.ok, `${inv.name}: ${inv.detail ?? ""}`).toBe(true);
      }

      // TODO(tier3): persist report.judgeScores to a trend artifact instead
      // of asserting; only soft-warn when below scenario.minJudgeScore.
    }, 300_000);
  }

  it.todo(
    "writes a run report artifact (scores + invariants) for trend tracking"
  );
});
