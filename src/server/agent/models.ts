/**
 * Server-side Agent model helpers. Cross-runtime types live in shared/agent-model.ts.
 */

import {
  type AgentModel,
  VALID_AGENT_MODELS,
} from "../../shared/agent-model.ts";

export type { AgentModel } from "../../shared/agent-model.ts";

/** Default Agent model order — first available wins. */
export const DEFAULT_AGENT_MODEL_PRIORITY: readonly AgentModel[] = [
  "composer-2.5-fast",
  "composer-2.5",
  "claude-sonnet-4-6",
  "default",
];

const COMPOSER_MODELS: ReadonlySet<AgentModel> = new Set([
  "composer-2.5",
  "composer-2.5-fast",
]);

const CLAUDE_MODELS: ReadonlySet<AgentModel> = new Set([
  "default",
  "claude-sonnet-4-6",
  "claude-opus-4-7",
]);

export function parseAgentModel(value: unknown): AgentModel | null {
  if (
    typeof value !== "string" ||
    !VALID_AGENT_MODELS.has(value as AgentModel)
  ) {
    return null;
  }
  return value as AgentModel;
}

export function isComposerModel(model: AgentModel): boolean {
  return COMPOSER_MODELS.has(model);
}

export function isClaudeModel(model: AgentModel): boolean {
  return CLAUDE_MODELS.has(model);
}

/** Preferred model first, then the priority list without duplicates. */
export function buildAgentModelChain(
  preferred: AgentModel,
  priority: readonly AgentModel[] = DEFAULT_AGENT_MODEL_PRIORITY
): AgentModel[] {
  const chain: AgentModel[] = [preferred];
  for (const model of priority) {
    if (model !== preferred) {
      chain.push(model);
    }
  }
  return chain;
}
