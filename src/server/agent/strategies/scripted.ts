/**
 * SCAFFOLDING — deterministic *scripted* agent for screenshot/switching e2e.
 *
 * Why this exists (see PR #30 discussion): the existing stub agent
 * (`strategies/stub.ts`) edits the target file by appending a JS *comment*, so
 * every variant renders identically to baseline. That makes screenshot
 * ACCURACY and per-variant capture impossible to assert — exactly the area
 * that "feels off". This module is the planned replacement for e2e:
 *
 *   1. VISIBLE edits — each variant produces a visually distinct render so a
 *      thumbnail/active-page assertion can tell versions apart.
 *   2. GATED pacing — each variant blocks until the test explicitly advances
 *      it, so a spec can hold "variant N in progress" and, in that exact
 *      window, attempt a mid-run switch with zero reliance on sleeps/timing.
 *
 * Enabled by `FORKDESIGN_E2E_SCRIPTED=1` (distinct from the plain stub flag so
 * existing specs are untouched). Strictly test-only; never reachable in prod.
 *
 * NOTE: the body is intentionally a placeholder that delegates to the stub so
 * the pipeline still produces a real version and the build stays green. Replace
 * the TODO sections to finish the harness.
 */
import type { AgentResult, AgentRunInput } from "../types.ts";
import { runStubAgent } from "./stub.ts";

/** Env flag that selects the scripted agent (set by a future e2e webServer). */
const SCRIPTED_AGENT_ENV = "FORKDESIGN_E2E_SCRIPTED";

export function isScriptedAgentEnabled(): boolean {
  return process.env[SCRIPTED_AGENT_ENV] === "1";
}

/*
 * TODO(gate-registry): in-memory barrier set, keyed by `${commentId}:${variantIndex}`.
 *
 * Shape to implement:
 *   interface Gate { release: () => void; released: Promise<void>; arrived: () => void; arrivedPromise: Promise<void>; }
 *   const gates = new Map<string, Gate>();
 *
 * - `gateKey(commentId, variantIndex)` builds the key.
 * - `ensureGate(key)` lazily creates a Gate with two deferred promises:
 *     • `arrivedPromise` resolves when the agent REACHES the gate (so the test
 *       can wait for "variant N is now in progress" instead of polling).
 *     • `released` resolves when the test calls advance for that key.
 * - Must live in module scope (single dev-server process) so the HTTP control
 *   endpoint and the agent run share the same map.
 */

/**
 * TODO(visible-edit): rewrite the anchored element so variant N renders
 * distinctly. The fixture (see tests/fixtures/playground/src/components/
 * RepeatedCard.tsx) carries sentinels for this:
 *
 *   - text node `Design baseline`  → `Design variant ${n}`
 *   - attribute `data-fd-variant="base"` → `data-fd-variant="v${n}"`
 *   - inline style background keyed to `n` (e.g. VARIANT_COLORS[n])
 *
 * Each variant is reset to the pre-agent baseline before this runs (see
 * run-iteration.ts), so a single string/regex swap from the baseline token is
 * deterministic and idempotent across variants. Read input.file via
 * resolveSafeProjectRelativePath + readFile, transform, atomicWriteText.
 *
 * Keep the `@comment`/`data-comment-anchor` markers intact, and keep the edit
 * on stable lines so the capture's render-signature actually changes (the
 * client waits for a render-signature delta before capturing — see
 * capture-iteration-screenshot.ts:waitForVersionRender).
 */

export function runScriptedAgent(input: AgentRunInput): Promise<AgentResult> {
  // TODO(gate-arrival): signal that this (commentId, variantIndex) has reached
  // the gate, then `await gate.released` (also resolve early on input.signal
  // abort and return a cancelled AgentResult, mirroring runStubAgent).

  // TODO(visible-edit): replace the delegation below with the real visible
  // transform described above.
  return runStubAgent(input);
}

/**
 * TODO(control-plane): release the next gated variant for a comment.
 *
 * Called by the test-only HTTP endpoint (see
 * src/server/api/iterations/e2e-control.ts). Return whether a gate was actually
 * released so the endpoint can 404/409 on a no-op. Consider an `advanceAll`
 * variant and a `waitForArrival(commentId, variantIndex)` the endpoint can
 * await before responding, so the test gets a clean "in progress" signal.
 */
export function advanceScriptedAgentVariant(_commentId: string): boolean {
  // TODO: look up the next unreleased gate for `_commentId` and release it.
  return false;
}

/** TODO(reset): clear all gates between specs (call from an e2e afterEach hook). */
export function resetScriptedAgentGates(): void {
  // TODO: gates.clear()
}
