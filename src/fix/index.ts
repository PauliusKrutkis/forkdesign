import { getFixRuntimeConfig } from "./config.ts";
import {
  isCursorModelAvailable,
  listAvailableCursorModels,
} from "./cursor-models.ts";
import { shouldFallbackFix } from "./fallback.ts";
import {
  buildFixModelChain,
  DEFAULT_FIX_MODEL_PRIORITY,
  type FixModel,
  isComposerModel,
} from "./models.ts";
import { claudeStrategy } from "./strategies/claude.ts";
import { cursorCliStrategy } from "./strategies/cursor-cli.ts";
import type {
  FixAttemptResult,
  FixInput,
  FixResult,
  FixRunInput,
  FixStrategy,
} from "./types.ts";

export { configureFixRuntime, resetFixRuntimeConfig } from "./config.ts";
export type { FixModel } from "./models.ts";
export {
  buildFixModelChain,
  DEFAULT_FIX_MODEL_PRIORITY,
  parseFixModel,
} from "./models.ts";
export {
  buildIteratePrompt,
  shouldIncludeScreenshotInPrompt,
} from "./prompt.ts";
export type {
  FixInput,
  FixProgress,
  FixResult,
  FixRunInput,
  FixStrategy,
} from "./types.ts";

export function resolveFixStrategy(model: FixModel): FixStrategy {
  switch (model) {
    case "composer-2.5":
    case "composer-2.5-fast":
      return cursorCliStrategy;
    case "default":
    case "claude-sonnet-4-6":
    case "claude-opus-4-7":
      return claudeStrategy;
  }
}

export async function runFix(input: FixRunInput): Promise<FixResult> {
  const config = getFixRuntimeConfig();
  const priority = config.fixModelPriority ?? DEFAULT_FIX_MODEL_PRIORITY;
  const chain = buildFixModelChain(input.model, priority);
  const agentPath =
    config.cursorAgentPath ?? process.env.CURSOR_AGENT_PATH ?? "agent";
  const availableCursorModels = await listAvailableCursorModels(agentPath);

  const modelsTried: FixModel[] = [];
  let lastError = "No fix models available";

  for (const model of chain) {
    if (
      isComposerModel(model) &&
      !isCursorModelAvailable(model, availableCursorModels)
    ) {
      // eslint-disable-next-line no-console
      console.info(`[fix] skipping ${model} — not listed by \`agent models\``);
      continue;
    }

    modelsTried.push(model);
    // eslint-disable-next-line no-console
    console.info(
      `[fix] trying model=${model} (strategy=${resolveFixStrategy(model).id})`
    );
    const startedAt = Date.now();

    const result = await runFixAttempt({ ...input, model });

    if (result.ok) {
      const elapsedMs = Date.now() - startedAt;
      // eslint-disable-next-line no-console
      console.info(
        `[fix] success model=${model} turns=${result.turnsUsed} tools=${result.toolCalls} ${elapsedMs}ms`
      );
      return { ...result, modelUsed: model };
    }

    // eslint-disable-next-line no-console
    console.warn(`[fix] failed model=${model}: ${result.error}`);
    lastError = result.error;

    if (!shouldFallbackFix(result.error)) {
      return { ok: false, error: result.error, modelsTried };
    }
  }

  if (modelsTried.length === 0) {
    return {
      ok: false,
      error:
        "No fix models available for this environment (Cursor CLI models probe empty)",
    };
  }

  return {
    ok: false,
    error: `All fix models failed (tried: ${modelsTried.join(", ")}). Last error: ${lastError}`,
    modelsTried,
  };
}

async function runFixAttempt(input: FixInput): Promise<FixAttemptResult> {
  const strategy = resolveFixStrategy(input.model);
  return strategy.run(input);
}
