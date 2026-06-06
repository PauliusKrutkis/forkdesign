import { describe, expect, it } from "vitest";
import {
  buildIteratePrompt,
  shouldIncludeScreenshotInPrompt,
  summarizeAgentSourceDiff,
} from "./prompt.ts";

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
    expect(prompt).toContain(
      'data-comment-anchor="550e8400-e29b-41d4-a716-446655440000"'
    );
    expect(prompt).toContain("src/pages/Home.tsx");
    expect(prompt).toContain("{/* @comment ... */}");
    expect(prompt).toContain(
      "Do not use Glob or Grep unless the anchor is missing"
    );
    expect(prompt).toContain("After one successful Edit, stop immediately");
  });

  it("includes screenshot path under public/ when provided and text is ambiguous", () => {
    const prompt = buildIteratePrompt({
      ...base,
      screenshot: "/designs/iterations/abc/v0.png",
    });
    expect(prompt).toContain("/proj/public/designs/iterations/abc/v0.png");
    expect(prompt).toContain(
      "Read this image only if the text feedback above is ambiguous"
    );
  });

  it("omits screenshot section for explicit className feedback", () => {
    const prompt = buildIteratePrompt({
      ...base,
      text: "add text-red-500",
      screenshot: "/designs/iterations/abc/v0.png",
    });
    expect(prompt).not.toContain("Visual context");
    expect(prompt).not.toContain("Read this image");
  });

  it("includes view context when provided", () => {
    const prompt = buildIteratePrompt({
      ...base,
      view: "hero",
    });
    expect(prompt).toContain('data-view="hero"');
  });

  it("includes frontend-design guidance when selected", () => {
    const prompt = buildIteratePrompt({
      ...base,
      skills: ["frontend-design"],
    });
    expect(prompt).toContain("## Skill: frontend-design");
    expect(prompt).toContain("intentional visual direction");
    expect(prompt).toContain("Keep the edit scoped to the anchored UI");
  });

  it("includes version-scoped replies for the active version", () => {
    const prompt = buildIteratePrompt({
      ...base,
      activeVersion: 1,
      replies: [
        {
          author: "alice@co",
          date: "2026-05-01T12:00:00Z",
          text: "Still too bold",
          v: 1,
        },
        {
          author: "bob@co",
          date: "2026-05-01T13:00:00Z",
          text: "Wrong version",
          v: 0,
        },
      ],
    });
    expect(prompt).toContain("## Additional feedback (on v2)");
    expect(prompt).toContain('"Still too bold" — alice@co');
    expect(prompt).not.toContain("Wrong version");
  });

  it("includes unversioned replies as supplemental feedback", () => {
    const prompt = buildIteratePrompt({
      ...base,
      activeVersion: 0,
      replies: [
        {
          author: "alice@co",
          date: "2026-05-01T12:00:00Z",
          text: "General note",
        },
      ],
    });
    expect(prompt).toContain("## Unversioned feedback");
    expect(prompt).toContain('"General note" — alice@co');
  });

  it("adds multi-variant diversity instructions when count > 1", () => {
    const prompt = buildIteratePrompt({
      ...base,
      variantIndex: 2,
      variantCount: 3,
      priorVariantApproaches: ["Variant 1: added text-blue-500"],
    });
    expect(prompt).toContain("variant **2 of 3**");
    expect(prompt).toContain("visually distinct");
    expect(prompt).toContain("Variant 1: added text-blue-500");
    expect(prompt).toContain("Do **not** repeat those approaches");
    expect(prompt).toContain("distinct valid interpretation");
    expect(prompt).not.toContain("Make the smallest possible edit");
  });

  it("keeps single-variant smallest-edit guidance", () => {
    const prompt = buildIteratePrompt(base);
    expect(prompt).not.toContain("Multi-variant run");
    expect(prompt).toContain("Make the smallest possible edit");
  });
});

describe("summarizeAgentSourceDiff", () => {
  it("describes changed lines", () => {
    const summary = summarizeAgentSourceDiff(
      '<div className="text-sm">',
      '<div className="text-sm text-blue-500">'
    );
    expect(summary).toContain("text-blue-500");
  });
});

describe("shouldIncludeScreenshotInPrompt", () => {
  it("returns false for explicit Tailwind color feedback", () => {
    expect(shouldIncludeScreenshotInPrompt("add text-red-500")).toBe(false);
  });

  it("returns true for vague feedback", () => {
    expect(shouldIncludeScreenshotInPrompt("feels too heavy")).toBe(true);
  });
});
