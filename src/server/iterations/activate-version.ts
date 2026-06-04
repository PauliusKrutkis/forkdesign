import { readFile } from "node:fs/promises";
import type { FoundComment } from "../comments/find-comment.ts";
import { readCommentsFromSource } from "../comments/reader.ts";
import { updateCommentActive } from "../comments/writer.ts";
import {
  extractDirectiveInner,
  injectExistingMarkerIntoSource,
  replaceCommentMarkerInSource,
} from "../comments/writer-directive.ts";
import { WriteError } from "../comments/writer-errors.ts";
import { atomicWriteText } from "../platform/atomic-write.ts";
import { errorMessage } from "../platform/http.ts";
import { findVersionSnapshotPath } from "./manifest.ts";

export type IterationApplyResult =
  | { ok: true }
  | { ok: false; status: number; message: string };

type ReadSourceResult =
  | { ok: true; text: string }
  | { ok: false; status: number; message: string };

function iterationApplyError(
  status: number,
  message: string
): IterationApplyResult {
  return { ok: false, status, message };
}

function writeErrorToApplyResult(err: unknown): IterationApplyResult {
  if (err instanceof WriteError) {
    return iterationApplyError(err.status, err.message);
  }
  return iterationApplyError(500, errorMessage(err));
}

async function readUtf8OrApplyError(
  filePath: string
): Promise<ReadSourceResult> {
  try {
    const text = await readFile(filePath, "utf8");
    return { ok: true, text };
  } catch (err) {
    return {
      ok: false,
      status: 500,
      message: errorMessage(err),
    };
  }
}

function snapshotContainsCommentMarker(
  snapshotSource: string,
  id: string
): boolean {
  try {
    const parsedSnapshot = readCommentsFromSource(snapshotSource);
    return parsedSnapshot.comments.some((c) => c.id === id);
  } catch {
    return false;
  }
}

type MergeSnapshotResult =
  | { ok: true; source: string }
  | { ok: false; status: number; message: string };

function mergeSnapshotError(
  status: number,
  message: string
): MergeSnapshotResult {
  return { ok: false, status, message };
}

function writeErrorToMergeResult(err: unknown): MergeSnapshotResult {
  if (err instanceof WriteError) {
    return mergeSnapshotError(err.status, err.message);
  }
  return mergeSnapshotError(500, errorMessage(err));
}

function mergeSnapshotWithDirective(
  snapshotSource: string,
  found: FoundComment,
  id: string,
  v: number,
  directiveInner: string
): MergeSnapshotResult {
  const snapshotHasMarker = snapshotContainsCommentMarker(snapshotSource, id);
  try {
    if (snapshotHasMarker) {
      return {
        ok: true,
        source: replaceCommentMarkerInSource(
          snapshotSource,
          id,
          directiveInner
        ),
      };
    }
    if (
      snapshotSource.includes(`data-comment-anchor="${found.comment.anchor}"`)
    ) {
      console.warn(
        `[vite-plugin-comments] injected marker into v${v} snapshot of comment ${id} before activating (snapshot pre-dated the marker)`
      );
      return {
        ok: true,
        source: injectExistingMarkerIntoSource(
          snapshotSource,
          found.comment.anchor,
          directiveInner
        ),
      };
    }
    return mergeSnapshotError(
      400,
      "snapshot is too old to safely activate; it pre-dates the anchor attribute."
    );
  } catch (err) {
    return writeErrorToMergeResult(err);
  }
}

export async function applyIterationVersionToSource(
  found: FoundComment,
  iterationRoots: string[],
  id: string,
  v: number
): Promise<IterationApplyResult> {
  const snapshotPath = findVersionSnapshotPath(iterationRoots, v);
  if (!snapshotPath) {
    return iterationApplyError(400, `version snapshot not found: v${v}.tsx`);
  }

  if (found.siblingIds.length > 0) {
    console.warn(
      `[vite-plugin-comments] activating v${v} for comment ${id} will overwrite ${found.siblingIds.length} other comment(s) in ${found.relativePath}`
    );
  }

  const currentRead = await readUtf8OrApplyError(found.absolutePath);
  if (!currentRead.ok) {
    return currentRead;
  }
  const directiveInner = extractDirectiveInner(currentRead.text, id);
  if (directiveInner === null) {
    return iterationApplyError(
      500,
      `could not extract directive for comment ${id} from current source`
    );
  }

  const snapshotRead = await readUtf8OrApplyError(snapshotPath);
  if (!snapshotRead.ok) {
    return snapshotRead;
  }

  const merged = mergeSnapshotWithDirective(
    snapshotRead.text,
    found,
    id,
    v,
    directiveInner
  );
  if (!merged.ok) {
    return merged;
  }

  try {
    await atomicWriteText(found.absolutePath, merged.source);
  } catch (err) {
    return writeErrorToApplyResult(err);
  }

  try {
    await updateCommentActive({
      absolutePath: found.absolutePath,
      commentId: id,
      active: v,
    });
  } catch (err) {
    return writeErrorToApplyResult(err);
  }

  return { ok: true };
}
