/**
 * Cross-runtime Agent model contract — safe for client and server imports.
 * No Node or React dependencies.
 */

export type AgentModel =
  | "default"
  | "claude-sonnet-4-6"
  | "claude-opus-4-7"
  | "composer-2.5"
  | "composer-2.5-fast";

export const VALID_AGENT_MODELS: ReadonlySet<AgentModel> = new Set([
  "default",
  "claude-sonnet-4-6",
  "claude-opus-4-7",
  "composer-2.5",
  "composer-2.5-fast",
]);
