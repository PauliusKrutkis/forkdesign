/**
 * STUB — Tier 2 real-agent eval harness.
 *
 * Runs ONE `EvalScenario` end-to-end against the REAL agent (no stub) and grades
 * the output. This is the seam that intentionally does NOT install `stubAgent`:
 * it calls the real `runAgent` from src/server/agent/index.ts, which drives the
 * Claude Agent SDK and edits files on disk.
 *
 * Reuses the deterministic test harness for everything EXCEPT the agent:
 *   - `createTempProject()` (tests/helpers/temp-project.ts) for an isolated tree,
 *   - the real comment writer + `runNewIteration` to drive the actual flow,
 *   - `applyIterationVersionToSource` for activate/revert checks.
 *
 * Output of a run = a graded report (invariants + optional judge score) that the
 * test file asserts on and that the trend tooling can persist.
 */

import type { EvalScenario } from "./scenarios.ts";
// TODO(tier2): import the REAL seam (NOT the stub):
//   import { runAgent } from "../../src/server/agent/index.ts";
//   import { runNewIteration } from "../../src/server/iterations/run-iteration.ts";
//   import { writeCommentToFile } from "../../src/server/comments/writer.ts";
//   import { findCommentById } from "../../src/server/comments/find-comment.ts";
//   import { createTempProject } from "../helpers/index.ts";
//   import { judgeVariant } from "./judge.ts";

export interface InvariantResult {
  detail?: string;
  name: string;
  ok: boolean;
}

export interface ScenarioReport {
  /** Whether the run completed and produced the expected variant count. */
  completed: boolean;
  /** Objective checks (file parses, isolation, visual change, ...). */
  invariants: InvariantResult[];
  /** Tier 3 judge scores per variant (1–5), if the judge ran. */
  judgeScores?: number[];
  /** Free-form notes for the trend log. */
  notes?: string;
  scenarioId: string;
}

/**
 * Materialize a scenario into a temp project, run the REAL agent, grade it.
 *
 * TODO(tier2): implement:
 *   1. createTempProject() (multi-component fixture).
 *   2. locate targetTag in targetFile, writeCommentToFile, findCommentById.
 *   3. capture a BASELINE screenshot (reuse capture-iteration-screenshot or a
 *      headless render of the fixture; decide and document).
 *   4. runNewIteration({ count: scenario.variantCount, ... }) with NO stub —
 *      requires ANTHROPIC_API_KEY; enforce a budget/timeout cap.
 *   5. checkInvariants(...) → InvariantResult[].
 *   6. if scenario.minJudgeScore != null → judgeVariant(...) per variant.
 *   7. return ScenarioReport; ALWAYS cleanup the temp project.
 */
// biome-ignore lint/suspicious/useAwait: stub — the real Tier 2 impl awaits runAgent/runNewIteration
export async function runScenario(
  _scenario: EvalScenario
): Promise<ScenarioReport> {
  // TODO(tier2): real implementation. Throwing keeps the stub honest if the
  // suite is ever run before it's built.
  throw new Error("runScenario: not implemented (Tier 2 stub)");
}

/**
 * Objective grading: parse/typecheck the edited file, confirm only `mayEdit`
 * files changed, confirm `mustNotDisturb` markers are byte-identical, confirm
 * the screenshot delta when `expectVisualChange`.
 *
 * TODO(tier2): implement using a diff of the temp tree before/after + a TS
 * parse (or `tsc` on the temp file) + an image-diff threshold for screenshots.
 */
export function checkInvariants(): InvariantResult[] {
  throw new Error("checkInvariants: not implemented (Tier 2 stub)");
}
