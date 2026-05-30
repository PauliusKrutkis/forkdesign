/**
 * Fix model identifiers shared between overlay settings and the server-side
 * fix strategies. Kept in a leaf module with no Node imports so the client
 * bundle can import it safely.
 */

export type FixModel =
  | "default"
  | "claude-sonnet-4-6"
  | "claude-opus-4-7"
  | "composer-2.5";

export const VALID_FIX_MODELS: ReadonlySet<FixModel> = new Set([
  "default",
  "claude-sonnet-4-6",
  "claude-opus-4-7",
  "composer-2.5",
]);

export function parseFixModel(value: unknown): FixModel | null {
  if (typeof value !== "string" || !VALID_FIX_MODELS.has(value as FixModel)) {
    return null;
  }
  return value as FixModel;
}
