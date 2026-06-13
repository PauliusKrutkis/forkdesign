import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  restoreAuxFilesForVersion,
  writeVersionAuxFiles,
} from "./aux-files.ts";

describe("restoreAuxFilesForVersion", () => {
  let projectRoot: string;

  afterEach(async () => {
    if (projectRoot) {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("skips aux snapshot paths that escape the project root", async () => {
    projectRoot = await mkdtemp(path.join(tmpdir(), "forkdesign-aux-"));
    const iterDir = path.join(
      projectRoot,
      "designs",
      "iterations",
      "comment-a"
    );
    await mkdir(path.join(projectRoot, "src"), { recursive: true });
    await mkdir(iterDir, { recursive: true });

    const outside = path.join(projectRoot, "..", "outside-forkdesign-aux.txt");
    await rm(outside, { force: true });

    await writeVersionAuxFiles(iterDir, 0, {
      "src/safe.ts": "safe",
      "../outside-forkdesign-aux.txt": "outside",
    });

    const written = await restoreAuxFilesForVersion(projectRoot, [iterDir], 0);

    expect(
      await readFile(path.join(projectRoot, "src", "safe.ts"), "utf8")
    ).toBe("safe");
    expect(existsSync(outside)).toBe(false);
    expect(written).toEqual([path.join(projectRoot, "src", "safe.ts")]);
  });
});
