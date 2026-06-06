import { describe, expect, it } from "vitest";
import {
  parseActivateBody,
  parseDeleteVersionBody,
  parseNewIterationBody,
  parseScreenshotBody,
} from "./parse-body.ts";

describe("parseActivateBody", () => {
  it("accepts a valid body", () => {
    expect(parseActivateBody({ id: "comment-1", v: 2 })).toEqual({
      ok: true,
      value: { id: "comment-1", v: 2 },
    });
  });

  it("rejects missing id", () => {
    expect(parseActivateBody({ v: 1 })).toEqual({
      ok: false,
      reason: "field `id` must be a non-empty string",
    });
  });

  it("rejects negative version", () => {
    expect(parseActivateBody({ id: "comment-1", v: -1 })).toEqual({
      ok: false,
      reason: "field `v` must be a non-negative integer",
    });
  });
});

describe("parseDeleteVersionBody", () => {
  it("accepts v >= 1", () => {
    expect(parseDeleteVersionBody({ id: "comment-1", v: 1 })).toEqual({
      ok: true,
      value: { id: "comment-1", v: 1 },
    });
  });

  it("rejects baseline v0 deletion", () => {
    expect(parseDeleteVersionBody({ id: "comment-1", v: 0 })).toEqual({
      ok: false,
      reason:
        "field `v` must be an integer >= 1 (baseline v0 cannot be deleted)",
    });
  });

  it("rejects non-object body", () => {
    expect(parseDeleteVersionBody(null)).toEqual({
      ok: false,
      reason: "body must be a JSON object",
    });
  });
});

describe("parseNewIterationBody", () => {
  it("defaults count to 1 when not provided", () => {
    const parsed = parseNewIterationBody({ id: "abc" });
    expect(parsed).toEqual({
      ok: true,
      value: { id: "abc", count: 1 },
    });
  });

  it("accepts count within range", () => {
    expect(parseNewIterationBody({ id: "abc", count: 3 })).toEqual({
      ok: true,
      value: { id: "abc", count: 3 },
    });
  });

  it("rejects count below 1", () => {
    expect(parseNewIterationBody({ id: "abc", count: 0 })).toEqual({
      ok: false,
      reason: "field `count` must be an integer >= 1",
    });
  });

  it("rejects count above max", () => {
    expect(parseNewIterationBody({ id: "abc", count: 6 })).toEqual({
      ok: false,
      reason: "field `count` must be an integer <= 5",
    });
  });

  it("rejects non-integer count", () => {
    expect(parseNewIterationBody({ id: "abc", count: 1.5 })).toEqual({
      ok: false,
      reason: "field `count` must be an integer",
    });
  });

  it("rejects unsupported model", () => {
    const parsed = parseNewIterationBody({ id: "abc", model: "unknown" });
    expect(parsed.ok).toBe(false);
  });

  it("accepts supported skills and removes duplicates", () => {
    expect(
      parseNewIterationBody({
        id: "abc",
        skills: ["frontend-design", "frontend-design"],
      })
    ).toEqual({
      ok: true,
      value: { id: "abc", count: 1, skills: ["frontend-design"] },
    });
  });

  it("rejects unsupported skills", () => {
    expect(parseNewIterationBody({ id: "abc", skills: ["unknown"] })).toEqual({
      ok: false,
      reason: "unknown agent skill: unknown",
    });
  });
});

describe("parseScreenshotBody", () => {
  it("accepts a valid body", () => {
    expect(
      parseScreenshotBody({
        id: "comment-1",
        v: 0,
        screenshotPng: "data:image/png;base64,abc",
      })
    ).toEqual({
      ok: true,
      value: {
        id: "comment-1",
        v: 0,
        screenshotPng: "data:image/png;base64,abc",
      },
    });
  });

  it("rejects empty screenshotPng", () => {
    expect(
      parseScreenshotBody({ id: "comment-1", v: 0, screenshotPng: "" })
    ).toEqual({
      ok: false,
      reason: "field `screenshotPng` must be a non-empty string",
    });
  });
});
