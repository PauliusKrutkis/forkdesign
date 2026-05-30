import type { FixModel } from "./models.ts";
import { claudeStrategy } from "./strategies/claude.ts";
import { cursorCliStrategy } from "./strategies/cursor-cli.ts";
import type { FixInput, FixResult, FixStrategy } from "./types.ts";

export { configureFixRuntime, resetFixRuntimeConfig } from "./config.ts";
export type { FixModel } from "./models.ts";
export { parseFixModel, VALID_FIX_MODELS } from "./models.ts";
export { buildIteratePrompt } from "./prompt.ts";
export type { FixInput, FixProgress, FixResult, FixStrategy } from "./types.ts";

export function resolveFixStrategy(model: FixModel): FixStrategy {
  switch (model) {
    case "composer-2.5":
      return cursorCliStrategy;
    case "default":
    case "claude-sonnet-4-6":
    case "claude-opus-4-7":
      return claudeStrategy;
  }
}

export async function runFix(input: FixInput): Promise<FixResult> {
  const strategy = resolveFixStrategy(input.model);
  return strategy.run(input);
}
