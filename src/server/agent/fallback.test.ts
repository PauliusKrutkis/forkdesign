import { describe, expect, it } from "vitest";
import { shouldFallbackAgent } from "./fallback.ts";

describe("shouldFallbackAgent", () => {
  it("does not fallback on abort", () => {
    expect(shouldFallbackAgent("aborted")).toBe(false);
  });

  it("fallbacks on auth errors", () => {
    expect(
      shouldFallbackAgent("Cursor CLI not authenticated — run agent login")
    ).toBe(true);
  });

  it("fallbacks on missing CLI", () => {
    expect(
      shouldFallbackAgent(
        "Cursor CLI (`agent`) not found — install from https://cursor.com/docs/cli"
      )
    ).toBe(true);
  });

  it("fallbacks on bad model errors", () => {
    expect(shouldFallbackAgent("Bad model name: composer-2.5-fast")).toBe(true);
  });

  it("does not fallback on generic agent failures", () => {
    expect(shouldFallbackAgent("rate limit exceeded")).toBe(false);
  });
});
