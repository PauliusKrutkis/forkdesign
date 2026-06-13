/**
 * Deterministic stub agent for end-to-end tests.
 *
 * The real agent strategies (Claude SDK, Cursor CLI) are non-deterministic and
 * must never run in CI (see tests/e2e/README.md). To exercise the *iteration*
 * UI — progress streaming, the version switcher, cancellation — the Playwright
 * suite boots the dev server with `FORKDESIGN_E2E_STUB=1`. When that flag is
 * set, `runAgent` short-circuits here instead of resolving a real strategy
 * (which would also probe the Cursor CLI for a binary that isn't installed).
 *
 * The stub performs a small, deterministic edit to the comment's target file so
 * the normal iteration pipeline (diff → snapshot vN.tsx → manifest → active=N)
 * produces a real version. Multi-variant batches get a distinct edit per
 * `variantIndex`, so v1..vN differ.
 *
 * Slow mode: an instruction containing `STUB_SLOW_TOKEN` makes the stub wait
 * (abortably) before editing, giving cancellation tests a window to hit "Stop
 * agent". The token is stripped from the marker the stub writes.
 */
import { readFile } from "node:fs/promises";
import { atomicWriteText } from "../../platform/atomic-write.ts";
import { resolveSafeProjectRelativePath } from "../../platform/path-safety.ts";
import type { AgentResult, AgentRunInput } from "../types.ts";

/** Env flag that enables the stub (set by playwright.config webServer). */
export const STUB_AGENT_ENV = "FORKDESIGN_E2E_STUB";

/** Instruction marker that switches the stub into slow/abortable mode. */
export const STUB_SLOW_TOKEN = "[[slow]]";

/** How long slow mode waits before editing (abortable). */
const STUB_SLOW_MS = 6000;
const STUB_SLOW_POLL_MS = 50;

export function isStubAgentEnabled(): boolean {
  return process.env[STUB_AGENT_ENV] === "1";
}

/** Resolve after `ms`, or as soon as `signal` aborts. Returns true if aborted. */
function waitOrAbort(ms: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(true);
      return;
    }
    const deadline = Date.now() + ms;
    const tick = () => {
      if (signal?.aborted) {
        resolve(true);
        return;
      }
      if (Date.now() >= deadline) {
        resolve(false);
        return;
      }
      setTimeout(tick, STUB_SLOW_POLL_MS);
    };
    tick();
  });
}

/** A short, single-line, deterministic summary of the instruction. */
function stubSummary(text: string): string {
  return text
    .split(STUB_SLOW_TOKEN)
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

export async function runStubAgent(input: AgentRunInput): Promise<AgentResult> {
  const resolved = resolveSafeProjectRelativePath(
    input.projectRoot,
    input.file
  );
  if (!resolved.ok) {
    return { ok: false, error: `stub agent: ${resolved.reason}`, attempts: [] };
  }

  if (input.text.includes(STUB_SLOW_TOKEN)) {
    const aborted = await waitOrAbort(STUB_SLOW_MS, input.signal);
    if (aborted) {
      return { ok: false, error: "stub agent: cancelled", attempts: [] };
    }
  }
  if (input.signal?.aborted) {
    return { ok: false, error: "stub agent: cancelled", attempts: [] };
  }

  // Each variant in a batch is reset to the pre-agent baseline before this runs,
  // so appending a variant-indexed marker yields a distinct snapshot per version.
  const variant = input.variantIndex ?? 1;
  const current = await readFile(resolved.absolutePath, "utf8");
  const marker = `\n// forkdesign-stub variant ${variant}: ${stubSummary(input.text)}\n`;
  await atomicWriteText(resolved.absolutePath, current + marker);

  return {
    ok: true,
    modelUsed: input.model,
    turnsUsed: 1,
    toolCalls: 1,
    attempts: [],
  };
}
