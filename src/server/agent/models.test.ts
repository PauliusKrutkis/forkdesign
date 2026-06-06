import { describe, expect, it } from "vitest";
import {
  buildAgentModelChain,
  DEFAULT_AGENT_MODEL_PRIORITY,
} from "./models.ts";

describe("DEFAULT_AGENT_MODEL_PRIORITY", () => {
  it("prefers composer fast then standard then claude", () => {
    expect(DEFAULT_AGENT_MODEL_PRIORITY).toEqual([
      "composer-2.5-fast",
      "composer-2.5",
      "claude-sonnet-4-6",
      "default",
    ]);
  });
});

describe("buildAgentModelChain", () => {
  it("prepends the preferred model without duplicates", () => {
    expect(
      buildAgentModelChain("composer-2.5-fast", DEFAULT_AGENT_MODEL_PRIORITY)
    ).toEqual([
      "composer-2.5-fast",
      "composer-2.5",
      "claude-sonnet-4-6",
      "default",
    ]);
    expect(
      buildAgentModelChain("claude-sonnet-4-6", DEFAULT_AGENT_MODEL_PRIORITY)
    ).toEqual([
      "claude-sonnet-4-6",
      "composer-2.5-fast",
      "composer-2.5",
      "default",
    ]);
  });
});
