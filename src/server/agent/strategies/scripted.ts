/**
 * Deterministic *scripted* agent for the screenshot/switching e2e (PR #30).
 *
 * The plain stub (`strategies/stub.ts`) edits the target by appending a JS
 * line-comment, so every variant renders identically to baseline — screenshot
 * ACCURACY and per-variant capture can't be asserted. This strategy fixes that:
 *
 *   1. VISIBLE edits — each variant rewrites the anchored element's sentinels
 *      so it renders distinctly (text + data attribute + background colour).
 *   2. GATED pacing — each variant blocks at a per-(comment,variant) barrier
 *      until the test releases it via the control endpoint
 *      (api/iterations/e2e-control.ts). A spec can therefore hold "variant N in
 *      progress" and assert mid-run behaviour with no sleeps/timing flake.
 *
 * Enabled by `FORKDESIGN_E2E_SCRIPTED=1`. Strictly test-only; the gate barriers
 * would deadlock a real run, so this never runs outside the scripted e2e.
 */
import { readFile } from "node:fs/promises";
import { atomicWriteText } from "../../platform/atomic-write.ts";
import { resolveSafeProjectRelativePath } from "../../platform/path-safety.ts";
import type { AgentResult, AgentRunInput } from "../types.ts";

/** Env flag that selects the scripted agent (set by playwright.scripted.config). */
const SCRIPTED_AGENT_ENV = "FORKDESIGN_E2E_SCRIPTED";

/** Distinct background per variant so thumbnails are visually separable. */
const VARIANT_COLORS = ["#fde68a", "#bfdbfe", "#bbf7d0", "#fbcfe8", "#ddd6fe"];

export function isScriptedAgentEnabled(): boolean {
  return process.env[SCRIPTED_AGENT_ENV] === "1";
}

// One barrier per `${commentId}:${variantIndex}`. The agent resolves `arrived`
// when it reaches the gate and awaits `released`; the control endpoint awaits
// `arrived` (so the test gets a clean "in progress" signal) and resolves
// `released` to let the variant proceed. Module scope = shared across the gate
// endpoint and the agent run within the single dev-server process.

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

interface Gate {
  arrived: Deferred;
  isReleased: boolean;
  released: Deferred;
}

const gates = new Map<string, Gate>();

function gateKey(commentId: string, variantIndex: number): string {
  return `${commentId}:${variantIndex}`;
}

function ensureGate(commentId: string, variantIndex: number): Gate {
  const key = gateKey(commentId, variantIndex);
  let gate = gates.get(key);
  if (!gate) {
    gate = { arrived: deferred(), released: deferred(), isReleased: false };
    gates.set(key, gate);
  }
  return gate;
}

/**
 * Block until the test releases this variant (or the run is cancelled).
 * Returns true when the wait ended because of an abort.
 */
function awaitGate(
  commentId: string,
  variantIndex: number,
  signal?: AbortSignal
): Promise<boolean> {
  const gate = ensureGate(commentId, variantIndex);
  gate.arrived.resolve();

  if (gate.isReleased) {
    return Promise.resolve(false);
  }
  return new Promise<boolean>((resolve) => {
    if (signal?.aborted) {
      resolve(true);
      return;
    }
    gate.released.promise.then(() => resolve(false));
    signal?.addEventListener("abort", () => resolve(true), { once: true });
  });
}

/** Resolve once the agent has REACHED variant `variantIndex` for `commentId`. */
export function awaitScriptedAgentArrival(
  commentId: string,
  variantIndex: number
): Promise<void> {
  return ensureGate(commentId, variantIndex).arrived.promise;
}

/**
 * Release the currently-waiting variant for `commentId`. Variants run
 * sequentially, so at most one gate is arrived-and-unreleased at a time.
 * Returns whether a gate was actually released.
 */
export function advanceScriptedAgentVariant(commentId: string): boolean {
  const prefix = `${commentId}:`;
  for (const [key, gate] of gates) {
    if (key.startsWith(prefix) && !gate.isReleased) {
      gate.isReleased = true;
      gate.released.resolve();
      return true;
    }
  }
  return false;
}

/** Clear all gates between specs (called by the control endpoint's reset). */
export function resetScriptedAgentGates(): void {
  for (const gate of gates.values()) {
    // Unblock anything still parked so a cancelled run can unwind.
    gate.isReleased = true;
    gate.released.resolve();
  }
  gates.clear();
}

/**
 * Rewrite the comment's source so variant `n` renders distinctly. Relies on the
 * sentinels in the RepeatedCard fixture; each variant starts from the pre-agent
 * baseline (run-iteration.ts resets it), so a swap from the baseline tokens is
 * deterministic and idempotent. Returns false when no sentinel matched (the
 * pipeline then treats the variant as "no change").
 */
function applyVisibleVariantEdit(source: string, n: number): string | null {
  const color = VARIANT_COLORS[(n - 1) % VARIANT_COLORS.length];
  const next = source
    .replaceAll('data-fd-variant="base"', `data-fd-variant="v${n}"`)
    .replaceAll("Design baseline", `Design variant ${n}`)
    // Add a per-variant background so the captured PNG visibly differs.
    .replace("padding: 16 }", `padding: 16, background: "${color}" }`);
  return next === source ? null : next;
}

export async function runScriptedAgent(
  input: AgentRunInput
): Promise<AgentResult> {
  const commentId = input.commentId ?? "";
  const variantIndex = input.variantIndex ?? 1;

  const aborted = await awaitGate(commentId, variantIndex, input.signal);
  if (aborted || input.signal?.aborted) {
    return { ok: false, error: "scripted agent: cancelled", attempts: [] };
  }

  const resolved = resolveSafeProjectRelativePath(
    input.projectRoot,
    input.file
  );
  if (!resolved.ok) {
    return {
      ok: false,
      error: `scripted agent: ${resolved.reason}`,
      attempts: [],
    };
  }

  const current = await readFile(resolved.absolutePath, "utf8");
  const next = applyVisibleVariantEdit(current, variantIndex);
  if (next === null) {
    return {
      ok: false,
      error:
        "scripted agent: no sentinel found in target (expected RepeatedCard fixture)",
      attempts: [],
    };
  }
  await atomicWriteText(resolved.absolutePath, next);

  return {
    ok: true,
    modelUsed: input.model,
    turnsUsed: 1,
    toolCalls: 1,
    attempts: [],
  };
}
