import { describe, expect, it } from "vitest";
import { resolveAgentStrategy } from "./index.ts";

describe("resolveAgentStrategy", () => {
  it("routes Claude models to claude strategy", () => {
    expect(resolveAgentStrategy("default").id).toBe("claude");
    expect(resolveAgentStrategy("claude-sonnet-4-6").id).toBe("claude");
    expect(resolveAgentStrategy("claude-opus-4-7").id).toBe("claude");
  });

  it("routes composer models to cursor-cli strategy", () => {
    expect(resolveAgentStrategy("composer-2.5").id).toBe("cursor-cli");
    expect(resolveAgentStrategy("composer-2.5-fast").id).toBe("cursor-cli");
  });
});
