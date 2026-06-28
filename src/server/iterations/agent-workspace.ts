import { execFile } from "node:child_process";
import { cp, lstat, mkdir, rm, symlink } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { FoundComment } from "../comments/find-comment.ts";
import { atomicWriteText } from "../platform/atomic-write.ts";

const execFileAsync = promisify(execFile);

const FORKDESIGN_DIR = ".forkdesign";
const WORKSPACES_DIR = "workspaces";

/** Config files copied into temp-copy workspaces so agent CLIs resolve the project. */
const PROJECT_SKELETON_FILES = [
  "package.json",
  "vite.config.ts",
  "vite.config.js",
  "tsconfig.json",
  "tsconfig.app.json",
  "tsconfig.node.json",
  "index.html",
] as const;

export interface AgentWorkspaceHandle {
  cleanup: () => Promise<void>;
  workspaceRoot: string;
}

export function toWorkspacePath(
  projectRoot: string,
  workspaceRoot: string,
  liveAbsolutePath: string
): string {
  const rel = path.relative(projectRoot, liveAbsolutePath);
  return path.join(workspaceRoot, rel);
}

export function mapFoundCommentToWorkspace(
  found: FoundComment,
  projectRoot: string,
  workspaceRoot: string
): FoundComment {
  return {
    ...found,
    absolutePath: toWorkspacePath(
      projectRoot,
      workspaceRoot,
      found.absolutePath
    ),
  };
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function isGitRepo(projectRoot: string): Promise<boolean> {
  return pathExists(path.join(projectRoot, ".git"));
}

async function overlayBaselineFiles(
  workspaceRoot: string,
  baselineFiles: Map<string, string>
): Promise<void> {
  for (const [rel, content] of baselineFiles) {
    const abs = path.join(workspaceRoot, ...rel.split("/"));
    await mkdir(path.dirname(abs), { recursive: true });
    await atomicWriteText(abs, content);
  }
}

async function symlinkNodeModules(
  projectRoot: string,
  workspaceRoot: string
): Promise<void> {
  const target = path.join(projectRoot, "node_modules");
  const link = path.join(workspaceRoot, "node_modules");
  if (!(await pathExists(target)) || (await pathExists(link))) {
    return;
  }
  try {
    await symlink(target, link, "dir");
  } catch {
    // Worktree checkout may already include node_modules.
  }
}

async function copyProjectSkeleton(
  projectRoot: string,
  workspaceRoot: string
): Promise<void> {
  for (const name of PROJECT_SKELETON_FILES) {
    const src = path.join(projectRoot, name);
    if (await pathExists(src)) {
      await cp(src, path.join(workspaceRoot, name));
    }
  }
  await symlinkNodeModules(projectRoot, workspaceRoot);
}

async function createGitWorktree(
  projectRoot: string,
  workspacePath: string
): Promise<void> {
  await mkdir(path.dirname(workspacePath), { recursive: true });
  await execFileAsync("git", ["worktree", "add", workspacePath, "--detach"], {
    cwd: projectRoot,
  });
}

async function removeGitWorktree(
  projectRoot: string,
  workspacePath: string
): Promise<void> {
  try {
    await execFileAsync(
      "git",
      ["worktree", "remove", "--force", workspacePath],
      { cwd: projectRoot }
    );
  } catch {
    await rm(workspacePath, { recursive: true, force: true });
  }
  try {
    await execFileAsync("git", ["worktree", "prune"], { cwd: projectRoot });
  } catch {
    // Best-effort prune.
  }
}

/**
 * Isolated tree for agent edits during a multi-variant run. The live Vite
 * project root is never mutated by the variant loop — only snapshots and
 * explicit activate/finish paths touch live source.
 */
export async function createAgentWorkspace(args: {
  baselineFiles: Map<string, string>;
  projectRoot: string;
  runId: string;
}): Promise<AgentWorkspaceHandle> {
  const { baselineFiles, projectRoot, runId } = args;
  const workspaceRoot = path.join(
    projectRoot,
    FORKDESIGN_DIR,
    WORKSPACES_DIR,
    runId
  );
  let usedGit = false;

  if (await isGitRepo(projectRoot)) {
    try {
      await createGitWorktree(projectRoot, workspaceRoot);
      usedGit = true;
    } catch {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  }

  if (!usedGit) {
    await mkdir(workspaceRoot, { recursive: true });
    await copyProjectSkeleton(projectRoot, workspaceRoot);
  }

  await overlayBaselineFiles(workspaceRoot, baselineFiles);
  if (usedGit) {
    await symlinkNodeModules(projectRoot, workspaceRoot);
  }

  return {
    workspaceRoot,
    cleanup: async () => {
      if (usedGit) {
        await removeGitWorktree(projectRoot, workspaceRoot);
      } else {
        await rm(workspaceRoot, { recursive: true, force: true });
      }
    },
  };
}
