export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string };

export function requireObject(
  value: unknown
): ParseResult<Record<string, unknown>> {
  if (!value || typeof value !== "object") {
    return { ok: false, reason: "body must be a JSON object" };
  }
  return { ok: true, value: value as Record<string, unknown> };
}

export function requireNonEmptyString(
  obj: Record<string, unknown>,
  key: string
): ParseResult<string> {
  const raw = obj[key];
  if (typeof raw !== "string" || raw.length === 0) {
    return {
      ok: false,
      reason: `field \`${key}\` must be a non-empty string`,
    };
  }
  return { ok: true, value: raw };
}

export function requireInt(
  obj: Record<string, unknown>,
  key: string,
  opts: { min: number; max?: number }
): ParseResult<number> {
  const raw = obj[key];
  if (typeof raw !== "number" || !Number.isInteger(raw)) {
    return {
      ok: false,
      reason: `field \`${key}\` must be an integer`,
    };
  }
  if (raw < opts.min) {
    return {
      ok: false,
      reason: `field \`${key}\` must be an integer >= ${opts.min}`,
    };
  }
  if (opts.max !== undefined && raw > opts.max) {
    return {
      ok: false,
      reason: `field \`${key}\` must be an integer <= ${opts.max}`,
    };
  }
  return { ok: true, value: raw };
}
