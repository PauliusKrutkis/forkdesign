import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { collectAllowedTsxFiles, findCommentById } from "./find-comment.ts";
import { writeCommentToFile } from "./writer.ts";

const dir = mkdtempSync(path.join(tmpdir(), "find-comment-test-"));
const projectRoot = dir;
const srcDir = path.join(projectRoot, "src", "pages");

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(path.join(projectRoot, "src"), { recursive: true, force: true });
  mkdirSync(srcDir, { recursive: true });
});

const SOURCE = `export function P() {
  return (
    <div>
      <button>Save</button>
    </div>
  );
}
`;

describe("collectAllowedTsxFiles", () => {
  it("returns tsx files under src/ and respects excludeSrcPrefixes", async () => {
    writeFileSync(path.join(srcDir, "Allowed.tsx"), SOURCE, "utf8");
    mkdirSync(path.join(projectRoot, "src", "generated"), {
      recursive: true,
    });
    writeFileSync(
      path.join(projectRoot, "src", "generated", "Excluded.tsx"),
      SOURCE,
      "utf8"
    );

    const files = await collectAllowedTsxFiles(projectRoot, ["src/generated/"]);
    expect(files).toHaveLength(1);
    expect(files[0]).toBe(path.join(srcDir, "Allowed.tsx"));
  });
});

describe("findCommentById", () => {
  it("returns the owning file and sibling ids", async () => {
    const file = path.join(srcDir, "Widget.tsx");
    writeFileSync(file, SOURCE, "utf8");

    const first = await writeCommentToFile({
      absolutePath: file,
      line: 4,
      column: 7,
      text: "first",
      author: "dev@local",
    });
    const second = await writeCommentToFile({
      absolutePath: file,
      line: 4,
      column: 7,
      text: "second",
      author: "dev@local",
    });

    const found = await findCommentById(projectRoot, first.id, []);
    expect(found).not.toBeNull();
    expect(found?.relativePath).toBe("src/pages/Widget.tsx");
    expect(found?.comment.id).toBe(first.id);
    expect(found?.siblingIds).toEqual([second.id]);
  });

  it("returns null for unknown id", async () => {
    writeFileSync(path.join(srcDir, "Empty.tsx"), SOURCE, "utf8");
    const found = await findCommentById(projectRoot, "missing-id", []);
    expect(found).toBeNull();
  });

  it("skips unparseable files without throwing", async () => {
    writeFileSync(
      path.join(srcDir, "Broken.tsx"),
      "export const x = <<<",
      "utf8"
    );
    const validFile = path.join(srcDir, "Valid.tsx");
    writeFileSync(validFile, SOURCE, "utf8");
    const created = await writeCommentToFile({
      absolutePath: validFile,
      line: 4,
      column: 7,
      text: "ok",
      author: "dev@local",
    });

    const found = await findCommentById(projectRoot, created.id, []);
    expect(found?.comment.id).toBe(created.id);
  });
});
