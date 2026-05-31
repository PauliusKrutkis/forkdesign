/**
 * Cross-runtime Fix model contract — safe for client and server imports.
 * No Node or React dependencies.
 */

export type FixModel =
  | "default"
  | "claude-sonnet-4-6"
  | "claude-opus-4-7"
  | "composer-2.5"
  | "composer-2.5-fast";

export const VALID_FIX_MODELS: ReadonlySet<FixModel> = new Set([
  "default",
  "claude-sonnet-4-6",
  "claude-opus-4-7",
  "composer-2.5",
  "composer-2.5-fast",
]);
