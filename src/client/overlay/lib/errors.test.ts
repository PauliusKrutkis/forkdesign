import { describe, expect, it } from "vitest";
import { toErrorMessage } from "./errors.ts";

describe("toErrorMessage", () => {
  it("returns message from Error instances", () => {
    expect(toErrorMessage(new Error("boom"))).toBe("boom");
  });

  it("uses fallback for non-Error values", () => {
    expect(toErrorMessage("plain", "fallback")).toBe("fallback");
  });

  it("stringifies unknown values without fallback", () => {
    expect(toErrorMessage(42)).toBe("42");
  });
});
