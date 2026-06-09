import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  mergeBaselineAuxFiles,
  restoreAuxFilesForVersion,
} from "./aux-files.ts";

describe("auxiliary iteration files", () => {
  let projectRoot: string;

  afterEach(async () => {
    if (projectRoot) {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  async function createProject() {
    projectRoot = await mkdtemp(path.join(tmpdir(), "redline-aux-files-"));
    const iterDir = path.join(projectRoot, "designs", "iterations", "comment-a");
    await mkdir(iterDir, { recursive: true });
    await mkdir(path.join(projectRoot, "src"), { recursive: true });
    return { iterDir };
  }

  it("merges newly-seen baselines without overwriting existing captures", async () => {
    const { iterDir } = await createProject();
    const baselinePath = path.join(iterDir, "v0.files.json");
    await writeFile(
      baselinePath,
      JSON.stringify({ "src/A.tsx": "old baseline" }),
      "utf8"
    );

    await mergeBaselineAuxFiles(iterDir, {
      "src/A.tsx": "new baseline",
      "src/B.tsx": "first capture",
    });

    const merged = JSON.parse(await readFile(baselinePath, "utf8")) as Record<
      string,
      string | null
    >;
    expect(merged).toEqual({
      "src/A.tsx": "old baseline",
      "src/B.tsx": "first capture",
    });
  });

  it("deletes files whose baseline records them as absent", async () => {
    const { iterDir } = await createProject();
    const newFilePath = path.join(projectRoot, "src", "NewFile.tsx");
    await writeFile(newFilePath, "export const NewFile = () => null;\n", "utf8");
    await writeFile(
      path.join(iterDir, "v0.files.json"),
      JSON.stringify({ "src/NewFile.tsx": null }),
      "utf8"
    );

    const written = await restoreAuxFilesForVersion(projectRoot, [iterDir], 0);

    expect(written).toContain(newFilePath);
    expect(existsSync(newFilePath)).toBe(false);
  });

  it("reverts untouched files to baseline when activating a variant", async () => {
    const { iterDir } = await createProject();
    const cardPath = path.join(projectRoot, "src", "Card.tsx");
    const sharedPath = path.join(projectRoot, "src", "Shared.tsx");
    await writeFile(cardPath, "live card\n", "utf8");
    await writeFile(sharedPath, "live shared\n", "utf8");
    await writeFile(
      path.join(iterDir, "v0.files.json"),
      JSON.stringify({
        "src/Card.tsx": "baseline card\n",
        "src/Shared.tsx": "baseline shared\n",
      }),
      "utf8"
    );
    await writeFile(
      path.join(iterDir, "v1.files.json"),
      JSON.stringify({ "src/Shared.tsx": "variant shared\n" }),
      "utf8"
    );

    const written = await restoreAuxFilesForVersion(projectRoot, [iterDir], 1);

    expect(written).toEqual(expect.arrayContaining([cardPath, sharedPath]));
    expect(await readFile(cardPath, "utf8")).toBe("baseline card\n");
    expect(await readFile(sharedPath, "utf8")).toBe("variant shared\n");
  });

  it("treats corrupt version aux JSON as an empty target map", async () => {
    const { iterDir } = await createProject();
    const cardPath = path.join(projectRoot, "src", "Card.tsx");
    await writeFile(cardPath, "live variant\n", "utf8");
    await writeFile(
      path.join(iterDir, "v0.files.json"),
      JSON.stringify({ "src/Card.tsx": "baseline card\n" }),
      "utf8"
    );
    await writeFile(path.join(iterDir, "v1.files.json"), "not json", "utf8");

    await restoreAuxFilesForVersion(projectRoot, [iterDir], 1);

    expect(await readFile(cardPath, "utf8")).toBe("baseline card\n");
  });
});
