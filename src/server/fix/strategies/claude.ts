import {
  AbortError,
  type Options,
  query,
} from "@anthropic-ai/claude-agent-sdk";
import {
  countClaudeToolUseBlocks,
  projectClaudeProgress,
} from "../progress/claude.ts";
import { buildIteratePrompt } from "../prompt.ts";
import type { FixAttemptResult, FixInput, FixStrategy } from "../types.ts";

export const claudeStrategy: FixStrategy = {
  id: "claude",
  run: runClaudeFix,
};

async function runClaudeFix(input: FixInput): Promise<FixAttemptResult> {
  const prompt = buildIteratePrompt(input);

  const abortController = new AbortController();
  if (input.signal) {
    if (input.signal.aborted) {
      abortController.abort();
    } else {
      input.signal.addEventListener("abort", () => abortController.abort(), {
        once: true,
      });
    }
  }

  const options: Options = {
    cwd: input.projectRoot,
    permissionMode: "acceptEdits",
    abortController,
    maxTurns: 8,
    allowedTools: ["Read", "Edit"],
  };

  if (input.model !== "default") {
    options.model = input.model;
  }

  const counters = { turnsUsed: 0, toolCalls: 0 };

  try {
    for await (const event of query({ prompt, options })) {
      processClaudeEvent(event, input, counters);
    }
  } catch (err) {
    if (err instanceof AbortError) {
      return { ok: false, error: "aborted" };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  return { ok: true, ...counters };
}

function processClaudeEvent(
  event: unknown,
  input: FixInput,
  counters: { turnsUsed: number; toolCalls: number }
): void {
  const t = (event as { type?: string }).type;
  if (t === "assistant") {
    counters.turnsUsed += 1;
    counters.toolCalls += countClaudeToolUseBlocks(event);
  }
  console.info(`[claude-agent] ${t ?? "event"}`);

  if (!input.onEvent) {
    return;
  }
  try {
    const progress = projectClaudeProgress(event);
    if (progress) {
      input.onEvent(progress);
    }
  } catch {
    // never let progress reporting derail the loop
  }
}
