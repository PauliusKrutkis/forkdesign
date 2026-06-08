import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  isSafeIterationScreenshotPath,
  isSafePathSegment,
  resolveSafePagePath,
  resolveSafeProjectRelativePath,
} from "./path-safety.ts";

const projectRoot = "/tmp/redline-project";

describe("resolveSafePagePath", () => {
  it("accepts a valid src/pages/Foo.tsx path", () => {
    const result = resolveSafePagePath(projectRoot, "src/pages/Foo.tsx", []);
    expect(result).toEqual({
      ok: true,
      absolutePath: path.resolve(projectRoot, "src/pages/Foo.tsx"),
      relativePath: "src/pages/Foo.tsx",
    });
  });

  it("rejects absolute paths", () => {
    const result = resolveSafePagePath(projectRoot, "/etc/passwd.tsx", []);
    expect(result).toEqual({
      ok: false,
      reason: "file must be a relative path",
    });
  });

  it("rejects paths outside src/", () => {
    const result = resolveSafePagePath(projectRoot, "package.json", []);
    expect(result).toEqual({
      ok: false,
      reason: "file must be under src/",
    });
  });

  it("rejects path traversal via .. segments", () => {
    const result = resolveSafePagePath(
      projectRoot,
      "src/pages/../../secret.tsx",
      []
    );
    expect(result).toEqual({
      ok: false,
      reason: "path traversal rejected",
    });
  });

  it("rejects traversal via src/../ prefix", () => {
    const result = resolveSafePagePath(
      projectRoot,
      "src/../etc/passwd.tsx",
      []
    );
    expect(result).toEqual({
      ok: false,
      reason: "path traversal rejected",
    });
  });

  it("rejects non-.tsx extensions", () => {
    const result = resolveSafePagePath(projectRoot, "src/pages/Foo.ts", []);
    expect(result).toEqual({
      ok: false,
      reason: "file must end in .tsx",
    });
  });

  it("rejects files under excludeSrcPrefixes", () => {
    const result = resolveSafePagePath(
      projectRoot,
      "src/generated/Widget.tsx",
      ["src/generated/"]
    );
    expect(result).toEqual({
      ok: false,
      reason: "file is under src/generated/ (excluded via excludeSrcPrefixes)",
    });
  });

  it("normalizes platform separators before validation", () => {
    const result = resolveSafePagePath(
      projectRoot,
      path.join("src", "pages", "Foo.tsx"),
      []
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.relativePath).toBe("src/pages/Foo.tsx");
    }
  });
});

describe("isSafePathSegment", () => {
  it("accepts IDs safe for one path segment", () => {
    expect(isSafePathSegment("550e8400-e29b-41d4-a716-446655440000")).toBe(
      true
    );
    expect(isSafePathSegment("comment_a-1")).toBe(true);
  });

  it("rejects traversal and separators", () => {
    expect(isSafePathSegment("../evil")).toBe(false);
    expect(isSafePathSegment("nested/id")).toBe(false);
    expect(isSafePathSegment("")).toBe(false);
  });
});

describe("resolveSafeProjectRelativePath", () => {
  it("accepts a normal project-relative path", () => {
    const result = resolveSafeProjectRelativePath(
      projectRoot,
      "src/pages/Foo.tsx"
    );
    expect(result).toEqual({
      ok: true,
      absolutePath: path.resolve(projectRoot, "src/pages/Foo.tsx"),
      relativePath: "src/pages/Foo.tsx",
    });
  });

  it("rejects traversal outside the project", () => {
    expect(
      resolveSafeProjectRelativePath(projectRoot, "../outside.ts")
    ).toEqual({
      ok: false,
      reason: "path traversal rejected",
    });
    expect(
      resolveSafeProjectRelativePath(projectRoot, "src/../../outside.ts")
    ).toEqual({
      ok: false,
      reason: "path traversal rejected",
    });
  });
});

describe("isSafeIterationScreenshotPath", () => {
  it("accepts generated iteration screenshot paths", () => {
    expect(
      isSafeIterationScreenshotPath(
        "/designs/iterations/550e8400-e29b-41d4-a716-446655440000/v0.png"
      )
    ).toBe(true);
    expect(
      isSafeIterationScreenshotPath("/designs/iterations/comment-a/v2.png?t=1")
    ).toBe(true);
  });

  it("rejects traversal and non-iteration paths", () => {
    expect(
      isSafeIterationScreenshotPath("/designs/iterations/../evil/v0.png")
    ).toBe(false);
    expect(isSafeIterationScreenshotPath("https://example.com/a.png")).toBe(
      false
    );
  });

  it("can require the expected iteration id", () => {
    expect(
      isSafeIterationScreenshotPath(
        "/designs/iterations/comment-a/v0.png",
        "comment-a"
      )
    ).toBe(true);
    expect(
      isSafeIterationScreenshotPath(
        "/designs/iterations/comment-b/v0.png",
        "comment-a"
      )
    ).toBe(false);
  });
});
