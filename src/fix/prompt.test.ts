import { describe, expect, it } from "vitest";
import { buildIteratePrompt } from "./prompt.ts";

describe("buildIteratePrompt", () => {
  const base = {
    projectRoot: "/proj",
    file: "src/pages/Home.tsx",
    anchor: "550e8400-e29b-41d4-a716-446655440000",
    text: "Too heavy",
  };

  it("includes feedback, anchor, and comment constraints", () => {
    const prompt = buildIteratePrompt(base);
    expect(prompt).toContain('"Too heavy"');
    expect(prompt).toContain('data-comment-anchor="550e8400-e29b-41d4-a716-446655440000"');
    expect(prompt).toContain("src/pages/Home.tsx");
    expect(prompt).toContain("{/* @comment ... */}");
    expect(prompt).toContain("Do NOT change the `data-comment-anchor` attribute value.");
  });

  it("includes screenshot path under public/ when provided", () => {
    const prompt = buildIteratePrompt({
      ...base,
      screenshot: "/designs/iterations/abc/v0.png",
    });
    expect(prompt).toContain("/proj/public/designs/iterations/abc/v0.png");
    expect(prompt).toContain("Read this image");
  });

  it("includes view context when provided", () => {
    const prompt = buildIteratePrompt({
      ...base,
      view: "hero",
    });
    expect(prompt).toContain('data-view="hero"');
  });
});
