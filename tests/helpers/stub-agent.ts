/**
 * Deterministic, offline stub for the Claude Agent SDK
 * (`@anthropic-ai/claude-agent-sdk`), installed at the `runAgent` seam.
 *
 * The real agent seam: `src/server/agent/strategies/claude.ts` imports `query`
 * from `@anthropic-ai/claude-agent-sdk`, builds a prompt via
 * `buildIteratePrompt(input)`, then iterates the async generator returned by
 * `query({ prompt, options })`. The SDK process is what actually edits the
 * user's `.tsx` on disk (permissionMode "acceptEdits", allowedTools
 * ["Read", "Edit"]). `runAgent` in `src/server/agent/index.ts` wraps this with
 * model-chain fallback and returns `AgentResult` (see
 * `src/server/agent/types.ts`).
 *
 * For integration tests we must NEVER hit the network or spawn the real CLI.
 * `stubAgent()` replaces `runAgent` with a vitest spy (via `vi.spyOn` on the
 * imported `agent/index.ts` module — no top-level `vi.mock` needed, so it can
 * be called from `beforeEach`). The honored contract:
 *
 *   `runNewIteration` reads the comment file AFTER the agent returns and diffs
 *   it against a baseline to detect changes. So the stub's job is to WRITE the
 *   canned variant source to `found.absolutePath` (resolved from
 *   `input.projectRoot` + `input.file`) on disk, then resolve
 *   `{ ok: true, modelUsed, turnsUsed, toolCalls, attempts: [] }`. A stub that
 *   returns `ok:true` WITHOUT editing the file yields `changed:false` and no
 *   snapshot — configure a `source` (or per-variant edits) when a change is
 *   wanted.
 *
 * This module is Node-side; it does not run under happy-dom.
 */

import { vi } from "vitest";
// biome-ignore lint/performance/noNamespaceImport: vi.spyOn requires the module namespace object to install the runAgent spy
import * as agentModule from "../../src/server/agent/index.ts";
import type { AgentModel } from "../../src/server/agent/models.ts";
import type {
  AgentResult,
  AgentRunInput,
} from "../../src/server/agent/types.ts";
import { atomicWriteText } from "../../src/server/platform/atomic-write.ts";
import { resolveSafeProjectRelativePath } from "../../src/server/platform/path-safety.ts";

/** A canned variant the stub "produces" for a given run. */
export interface StubVariant {
  /**
   * Optional extra files to write, keyed by POSIX project-relative path. Lets
   * tests exercise the aux-file flow in `run-iteration.ts` / `aux-files.ts`
   * (cross-file edits the agent makes outside the comment file).
   */
  auxFiles?: Record<string, string>;
  /** Reported model in the `AgentResult`. Defaults to the requested model. */
  modelUsed?: AgentModel;
  /**
   * Full replacement source for the comment file the agent was pointed at
   * (`AgentRunInput.file`, resolved against `projectRoot`). When omitted, the
   * stub leaves the file untouched so tests can exercise the "no change" path
   * (`runNewIteration` treats an unchanged file as `changed: false`).
   */
  source?: string;
  toolCalls?: number;
  turnsUsed?: number;
}

/**
 * A variant, or a factory that derives one from the run input (so a single
 * default can produce a distinct edit per `variantIndex`).
 */
export type StubVariantSpec =
  | StubVariant
  | ((input: AgentRunInput) => StubVariant);

export interface StubAgentOptions {
  /**
   * The variant produced for every call that has no per-call / per-index
   * override. May be a function of the run input (handy for `count>1` runs that
   * inspect `variantIndex`). Defaults to a no-op (file untouched).
   */
  variant?: StubVariantSpec;
}

export interface StubAgentController {
  /**
   * Every `AgentRunInput` the stub was invoked with, in order. Lets tests
   * assert prompt-relevant fields: `file`, `anchor`, `text`, `screenshot`,
   * `view`, `variantIndex`/`variantCount`, `priorVariantApproaches`, `model`.
   * (To assert the *rendered* prompt string, combine with `buildIteratePrompt`
   * from `src/server/agent/prompt.ts` over the recorded input.)
   */
  readonly calls: readonly AgentRunInput[];
  /** Reset recorded calls and queued overrides (keeps the spy installed). */
  reset(): void;
  /** Uninstall the spy, restoring the real `runAgent`. Wire into `afterEach`. */
  restore(): void;
  /**
   * The installed spy standing in for `runAgent`. Equivalent to a `vi.fn()`; you
   * can assert on it directly (`expect(controller.runAgent).toHaveBeenCalled()`).
   */
  runAgent: (input: AgentRunInput) => Promise<AgentResult>;
  /** Force the NEXT call to fail with `{ ok: false, error }` (consumed once). */
  setNextError(error: string): void;
  /**
   * Override the variant returned on the NEXT call only (consumed once). Useful
   * for injecting a specific edit, an aux-file edit, or a no-op for one run.
   */
  setNextVariant(variant: StubVariant): void;
  /** Set the default variant (or factory) used when no override is queued. */
  setVariant(variant: StubVariantSpec): void;
  /**
   * Pin a variant to a specific 1-based `variantIndex` (for `count>1` batches).
   * Takes precedence over the default for matching calls.
   */
  setVariantForIndex(variantIndex: number, variant: StubVariant): void;
}

function resolveSpec(spec: StubVariantSpec, input: AgentRunInput): StubVariant {
  return typeof spec === "function" ? spec(input) : spec;
}

async function writeVariantFiles(
  input: AgentRunInput,
  variant: StubVariant
): Promise<void> {
  const files: Record<string, string> = {};
  if (variant.source !== undefined) {
    files[input.file] = variant.source;
  }
  Object.assign(files, variant.auxFiles ?? {});

  for (const [rel, contents] of Object.entries(files)) {
    const resolved = resolveSafeProjectRelativePath(input.projectRoot, rel);
    if (!resolved.ok) {
      throw new Error(
        `stubAgent: refusing to write unsafe path "${rel}": ${resolved.reason}`
      );
    }
    await atomicWriteText(resolved.absolutePath, contents);
  }
}

/**
 * Build a stub controller for the `runAgent` seam and install it immediately via
 * `vi.spyOn`. Call from `beforeEach`; call `controller.restore()` (or
 * `vi.restoreAllMocks()`) in `afterEach`.
 *
 * Example — drive an iteration end-to-end:
 *   const agent = stubAgent();
 *   const { id, anchor } = await writeCommentToFile({ absolutePath, ... });
 *   const found = await findCommentById(project.root, id, []);
 *   agent.setVariant({ source: editedSource });   // physically rewrites the file
 *   await runNewIteration({ projectRoot: project.root, found, id, count: 1, ... });
 *   expect(agent.calls[0].file).toBe(found.relativePath);
 */
export function createStubAgent(
  options: StubAgentOptions = {}
): StubAgentController {
  const calls: AgentRunInput[] = [];
  const perIndex = new Map<number, StubVariant>();
  let defaultVariant: StubVariantSpec = options.variant ?? {};
  let nextVariant: StubVariant | undefined;
  let nextError: string | undefined;

  const impl = async (input: AgentRunInput): Promise<AgentResult> => {
    calls.push(input);

    if (nextError !== undefined) {
      const error = nextError;
      nextError = undefined;
      return { ok: false, error, attempts: [] };
    }

    let variant: StubVariant;
    if (nextVariant !== undefined) {
      variant = nextVariant;
      nextVariant = undefined;
    } else if (
      input.variantIndex !== undefined &&
      perIndex.has(input.variantIndex)
    ) {
      variant = perIndex.get(input.variantIndex) as StubVariant;
    } else {
      variant = resolveSpec(defaultVariant, input);
    }

    await writeVariantFiles(input, variant);

    return {
      ok: true,
      modelUsed: variant.modelUsed ?? input.model,
      turnsUsed: variant.turnsUsed ?? 1,
      toolCalls: variant.toolCalls ?? 1,
      attempts: [],
    };
  };

  const spy = vi.spyOn(agentModule, "runAgent").mockImplementation(impl);

  return {
    runAgent: spy as unknown as StubAgentController["runAgent"],
    setVariant(variant: StubVariantSpec): void {
      defaultVariant = variant;
    },
    setNextVariant(variant: StubVariant): void {
      nextVariant = variant;
    },
    setVariantForIndex(variantIndex: number, variant: StubVariant): void {
      perIndex.set(variantIndex, variant);
    },
    setNextError(error: string): void {
      nextError = error;
    },
    get calls(): readonly AgentRunInput[] {
      return calls;
    },
    reset(): void {
      calls.length = 0;
      perIndex.clear();
      nextVariant = undefined;
      nextError = undefined;
      spy.mockClear();
    },
    restore(): void {
      spy.mockRestore();
    },
  };
}

/**
 * Ergonomic alias matching the name used throughout the integration test
 * scaffolds (`const agent = stubAgent();`).
 */
export const stubAgent = createStubAgent;
