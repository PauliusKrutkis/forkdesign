/**
 * Server-side Fix model helpers. Cross-runtime types live in shared/fix-model.ts.
 */

import { type FixModel, VALID_FIX_MODELS } from "../../shared/fix-model.ts";

export type { FixModel } from "../../shared/fix-model.ts";

/** Default Fix model order — first available wins. */
export const DEFAULT_FIX_MODEL_PRIORITY: readonly FixModel[] = [
  "composer-2.5-fast",
  "composer-2.5",
  "claude-sonnet-4-6",
  "default",
];

const COMPOSER_MODELS: ReadonlySet<FixModel> = new Set([
  "composer-2.5",
  "composer-2.5-fast",
]);

const CLAUDE_MODELS: ReadonlySet<FixModel> = new Set([
  "default",
  "claude-sonnet-4-6",
  "claude-opus-4-7",
]);

export function parseFixModel(value: unknown): FixModel | null {
  if (typeof value !== "string" || !VALID_FIX_MODELS.has(value as FixModel)) {
    return null;
  }
  return value as FixModel;
}

export function isComposerModel(model: FixModel): boolean {
  return COMPOSER_MODELS.has(model);
}

export function isClaudeModel(model: FixModel): boolean {
  return CLAUDE_MODELS.has(model);
}

/** Preferred model first, then the priority list without duplicates. */
export function buildFixModelChain(
  preferred: FixModel,
  priority: readonly FixModel[] = DEFAULT_FIX_MODEL_PRIORITY
): FixModel[] {
  const chain: FixModel[] = [preferred];
  for (const model of priority) {
    if (model !== preferred) {
      chain.push(model);
    }
  }
  return chain;
}
