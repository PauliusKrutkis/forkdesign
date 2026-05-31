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

  let turnsUsed = 0;
  let toolCalls = 0;

  try {
    for await (const event of query({ prompt, options })) {
      const t = (event as { type?: string }).type;
      if (t === "assistant") {
        turnsUsed += 1;
        toolCalls += countClaudeToolUseBlocks(event);
      }
      console.info(`[claude-agent] ${t ?? "event"}`);

      if (input.onEvent) {
        try {
          const progress = projectClaudeProgress(event);
          if (progress) {
            input.onEvent(progress);
          }
        } catch {
          // never let progress reporting derail the loop
        }
      }
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

  return { ok: true, turnsUsed, toolCalls };
}
