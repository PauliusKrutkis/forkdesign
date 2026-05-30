import { describe, expect, it } from "vitest";
import {
  buildFixModelChain,
  DEFAULT_FIX_MODEL_PRIORITY,
} from "./models.ts";

describe("DEFAULT_FIX_MODEL_PRIORITY", () => {
  it("prefers composer fast then standard then claude", () => {
    expect(DEFAULT_FIX_MODEL_PRIORITY).toEqual([
      "composer-2.5-fast",
      "composer-2.5",
      "claude-sonnet-4-6",
      "default",
    ]);
  });
});

describe("buildFixModelChain", () => {
  it("prepends the preferred model without duplicates", () => {
    expect(
      buildFixModelChain("composer-2.5-fast", DEFAULT_FIX_MODEL_PRIORITY)
    ).toEqual([
      "composer-2.5-fast",
      "composer-2.5",
      "claude-sonnet-4-6",
      "default",
    ]);
    expect(
      buildFixModelChain("claude-sonnet-4-6", DEFAULT_FIX_MODEL_PRIORITY)
    ).toEqual([
      "claude-sonnet-4-6",
      "composer-2.5-fast",
      "composer-2.5",
      "default",
    ]);
  });
});
