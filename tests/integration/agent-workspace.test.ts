import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createAgentWorkspace,
  mapFoundCommentToWorkspace,
  toWorkspacePath,
} from "../../src/server/iterations/agent-workspace.ts";

describe("agent workspace", () => {
  let projectRoot: string;

  afterEach(() => {
    if (projectRoot) {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("creates a temp-copy workspace and overlays the baseline snapshot", async () => {
    projectRoot = mkdtempSync(path.join(tmpdir(), "forkdesign-workspace-"));
    const sourcePath = path.join(projectRoot, "src", "App.tsx");
    mkdirSync(path.dirname(sourcePath), { recursive: true });
    writeFileSync(sourcePath, "export const live = 1;\n", "utf8");

    const baselineFiles = new Map([["src/App.tsx", "export const live = 1;\n"]]);
    const workspace = await createAgentWorkspace({
      projectRoot,
      runId: "run-test",
      baselineFiles,
    });

    try {
      expect(readFileSync(sourcePath, "utf8")).toBe("export const live = 1;\n");
      expect(readFileSync(path.join(workspace.workspaceRoot, "src/App.tsx"), "utf8")).toBe(
        "export const live = 1;\n"
      );
    } finally {
      await workspace.cleanup();
    }

    expect(
      existsSync(path.join(projectRoot, ".forkdesign/workspaces/run-test"))
    ).toBe(false);
  });

  it("maps live paths into the workspace tree", async () => {
    projectRoot = mkdtempSync(path.join(tmpdir(), "forkdesign-workspace-"));
    const livePath = path.join(projectRoot, "src", "Widget.tsx");
    const baselineFiles = new Map<string, string>();
    const workspace = await createAgentWorkspace({
      projectRoot,
      runId: "map-test",
      baselineFiles,
    });

    try {
      const mapped = mapFoundCommentToWorkspace(
        {
          absolutePath: livePath,
          relativePath: "src/Widget.tsx",
          siblingIds: [],
          comment: {
            id: "c1",
            anchor: "a1",
            text: "t",
          },
        },
        projectRoot,
        workspace.workspaceRoot
      );
      expect(mapped.absolutePath).toBe(
        toWorkspacePath(projectRoot, workspace.workspaceRoot, livePath)
      );
    } finally {
      await workspace.cleanup();
    }
  });
});
