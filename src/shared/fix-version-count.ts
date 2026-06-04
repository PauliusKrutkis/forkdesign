/** Max independent Fix-with-AI variants per request (client + server). */
export const MAX_FIX_VERSION_COUNT = 5;

export const DEFAULT_FIX_VERSION_COUNT = 1;

export function isValidFixVersionCount(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= DEFAULT_FIX_VERSION_COUNT &&
    value <= MAX_FIX_VERSION_COUNT
  );
}
