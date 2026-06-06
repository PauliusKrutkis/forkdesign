import { getAgentRuntimeConfig } from "./config.ts";
import {
  isCursorModelAvailable,
  listAvailableCursorModels,
} from "./cursor-models.ts";
import { shouldFallbackAgent } from "./fallback.ts";
import {
  type AgentModel,
  buildAgentModelChain,
  DEFAULT_AGENT_MODEL_PRIORITY,
  isComposerModel,
} from "./models.ts";
import { claudeStrategy } from "./strategies/claude.ts";
import { cursorCliStrategy } from "./strategies/cursor-cli.ts";
import type {
  AgentAttemptResult,
  AgentAttemptTiming,
  AgentInput,
  AgentResult,
  AgentRunInput,
  AgentStrategy,
} from "./types.ts";

export function resolveAgentStrategy(model: AgentModel): AgentStrategy {
  switch (model) {
    case "composer-2.5":
    case "composer-2.5-fast":
      return cursorCliStrategy;
    case "default":
    case "claude-sonnet-4-6":
    case "claude-opus-4-7":
      return claudeStrategy;
    default:
      return claudeStrategy;
  }
}

export async function runAgent(input: AgentRunInput): Promise<AgentResult> {
  const config = getAgentRuntimeConfig();
  const priority = config.agentModelPriority ?? DEFAULT_AGENT_MODEL_PRIORITY;
  const chain = buildAgentModelChain(input.model, priority);
  const agentPath =
    config.cursorAgentPath ?? process.env.CURSOR_AGENT_PATH ?? "agent";
  const availableCursorModels = await listAvailableCursorModels(agentPath);

  const modelsTried: AgentModel[] = [];
  const attempts: AgentAttemptTiming[] = [];
  let lastError = "No agent models available";

  for (const model of chain) {
    if (
      isComposerModel(model) &&
      !isCursorModelAvailable(model, availableCursorModels)
    ) {
      // eslint-disable-next-line no-console
      console.info(
        `[agent] skipping ${model} — not listed by \`agent models\``
      );
      continue;
    }

    modelsTried.push(model);
    // eslint-disable-next-line no-console
    console.info(
      `[agent] trying model=${model} (strategy=${resolveAgentStrategy(model).id})`
    );
    const startedAt = Date.now();

    const result = await runAgentAttempt({ ...input, model });
    const elapsedMs = Date.now() - startedAt;
    attempts.push({ model, ms: elapsedMs, ok: result.ok });

    if (result.ok) {
      // eslint-disable-next-line no-console
      console.info(
        `[agent] success model=${model} turns=${result.turnsUsed} tools=${result.toolCalls} ${elapsedMs}ms`
      );
      return { ...result, modelUsed: model, attempts };
    }

    // eslint-disable-next-line no-console
    console.warn(
      `[agent] failed model=${model}: ${result.error} (${elapsedMs}ms)`
    );
    lastError = result.error;

    if (!shouldFallbackAgent(result.error)) {
      return { ok: false, error: result.error, modelsTried, attempts };
    }
  }

  if (modelsTried.length === 0) {
    return {
      ok: false,
      error:
        "No agent models available for this environment (Cursor CLI models probe empty)",
      attempts,
    };
  }

  return {
    ok: false,
    error: `All agent models failed (tried: ${modelsTried.join(", ")}). Last error: ${lastError}`,
    modelsTried,
    attempts,
  };
}

function runAgentAttempt(input: AgentInput): Promise<AgentAttemptResult> {
  const strategy = resolveAgentStrategy(input.model);
  return strategy.run(input);
}
