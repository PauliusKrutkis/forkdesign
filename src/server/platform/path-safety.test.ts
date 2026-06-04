import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveSafePagePath } from "./path-safety.ts";

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
