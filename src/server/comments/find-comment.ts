import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import type { CommentReply } from "../../client/types.ts";
import { type ReadResult, readCommentsFromFile } from "../comments/reader.ts";
import { SRC_REL } from "../platform/path-safety.ts";

export interface FoundComment {
  absolutePath: string;
  comment: {
    id: string;
    anchor: string;
    text: string;
    screenshot?: string;
    view?: string;
    active?: number;
    replies?: CommentReply[];
  };
  relativePath: string;
  /** ids of OTHER @comment markers in the same file (for the activate warning). */
  siblingIds: string[];
}

export async function collectAllowedTsxFiles(
  projectRoot: string,
  excludeSrcPrefixes: string[]
): Promise<string[]> {
  const srcAbs = path.resolve(projectRoot, SRC_REL);
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    const rel = path
      .relative(projectRoot, dir)
      .split(path.sep)
      .join(path.posix.sep);
    if (excludeSrcPrefixes.some((p) => `${rel}/`.startsWith(p))) {
      return;
    }
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".tsx")) {
        const relFile = path
          .relative(projectRoot, full)
          .split(path.sep)
          .join(path.posix.sep);
        if (excludeSrcPrefixes.some((p) => relFile.startsWith(p))) {
          continue;
        }
        out.push(full);
      }
    }
  }
  await walk(srcAbs);
  return out;
}

/**
 * Walk all allowed .tsx files under src/ and find the one carrying the marker
 * with `id === commentId`. Returns null when no file owns the id.
 */
export async function findCommentById(
  projectRoot: string,
  commentId: string,
  excludeSrcPrefixes: string[]
): Promise<FoundComment | null> {
  const files = await collectAllowedTsxFiles(projectRoot, excludeSrcPrefixes);
  for (const absolutePath of files) {
    let result: ReadResult;
    try {
      result = await readCommentsFromFile(absolutePath);
    } catch {
      continue;
    }
    const match = result.comments.find((c) => c.id === commentId);
    if (!match) {
      continue;
    }
    const relativePath = path
      .relative(projectRoot, absolutePath)
      .split(path.sep)
      .join(path.posix.sep);
    return {
      absolutePath,
      relativePath,
      comment: {
        id: match.id,
        anchor: match.anchor,
        text: match.text,
        screenshot: match.screenshot,
        view: match.view ?? undefined,
        active: match.active,
        replies: match.replies,
      },
      siblingIds: result.comments
        .filter((c) => c.id !== commentId)
        .map((c) => c.id),
    };
  }
  return null;
}
