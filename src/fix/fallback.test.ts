import { describe, expect, it } from "vitest";
import { shouldFallbackFix } from "./fallback.ts";

describe("shouldFallbackFix", () => {
  it("does not fallback on abort", () => {
    expect(shouldFallbackFix("aborted")).toBe(false);
  });

  it("fallbacks on auth errors", () => {
    expect(shouldFallbackFix("Cursor CLI not authenticated — run agent login")).toBe(
      true,
    );
  });

  it("fallbacks on missing CLI", () => {
    expect(
      shouldFallbackFix(
        "Cursor CLI (`agent`) not found — install from https://cursor.com/docs/cli",
      ),
    ).toBe(true);
  });

  it("fallbacks on bad model errors", () => {
    expect(shouldFallbackFix("Bad model name: composer-2.5-fast")).toBe(true);
  });

  it("does not fallback on generic agent failures", () => {
    expect(shouldFallbackFix("rate limit exceeded")).toBe(false);
  });
});
