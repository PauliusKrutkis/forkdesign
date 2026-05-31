export interface ScreenshotBody {
  id: string;
  screenshotPng: string;
  v: number;
}

export function parseScreenshotBody(
  value: unknown
): { ok: true; value: ScreenshotBody } | { ok: false; reason: string } {
  if (!value || typeof value !== "object") {
    return { ok: false, reason: "body must be a JSON object" };
  }
  const obj = value as Record<string, unknown>;
  const id = obj.id;
  const v = obj.v;
  const screenshotPng = obj.screenshotPng;
  if (typeof id !== "string" || id.length === 0) {
    return { ok: false, reason: "field `id` must be a non-empty string" };
  }
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
    return { ok: false, reason: "field `v` must be a non-negative integer" };
  }
  if (typeof screenshotPng !== "string" || screenshotPng.length === 0) {
    return {
      ok: false,
      reason: "field `screenshotPng` must be a non-empty string",
    };
  }
  return { ok: true, value: { id, v, screenshotPng } };
}

export interface ActivateBody {
  id: string;
  v: number;
}

export function parseActivateBody(
  value: unknown
): { ok: true; value: ActivateBody } | { ok: false; reason: string } {
  if (!value || typeof value !== "object") {
    return { ok: false, reason: "body must be a JSON object" };
  }
  const obj = value as Record<string, unknown>;
  const id = obj.id;
  const v = obj.v;
  if (typeof id !== "string" || id.length === 0) {
    return { ok: false, reason: "field `id` must be a non-empty string" };
  }
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
    return { ok: false, reason: "field `v` must be a non-negative integer" };
  }
  return { ok: true, value: { id, v } };
}

export function parseDeleteVersionBody(
  value: unknown
): { ok: true; value: ActivateBody } | { ok: false; reason: string } {
  if (!value || typeof value !== "object") {
    return { ok: false, reason: "body must be a JSON object" };
  }
  const obj = value as Record<string, unknown>;
  const id = obj.id;
  const v = obj.v;
  if (typeof id !== "string" || id.length === 0) {
    return { ok: false, reason: "field `id` must be a non-empty string" };
  }
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1) {
    return {
      ok: false,
      reason:
        "field `v` must be an integer >= 1 (baseline v0 cannot be deleted)",
    };
  }
  return { ok: true, value: { id, v } };
}
