import { describe, expect, it } from "vitest";
import { resolveFixStrategy } from "./index.ts";

describe("resolveFixStrategy", () => {
  it("routes Claude models to claude strategy", () => {
    expect(resolveFixStrategy("default").id).toBe("claude");
    expect(resolveFixStrategy("claude-sonnet-4-6").id).toBe("claude");
    expect(resolveFixStrategy("claude-opus-4-7").id).toBe("claude");
  });

  it("routes composer models to cursor-cli strategy", () => {
    expect(resolveFixStrategy("composer-2.5").id).toBe("cursor-cli");
    expect(resolveFixStrategy("composer-2.5-fast").id).toBe("cursor-cli");
  });
});
