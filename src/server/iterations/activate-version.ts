import { readFile } from "node:fs/promises";
import {
  assertValidTsx,
  parseSourceAst,
  printAst,
} from "../comments/directive-ast.ts";
import type { FoundComment } from "../comments/find-comment.ts";
import {
  findJsxElementByAnchor,
  findJsxElementByCommentMarker,
} from "../comments/writer-ast.ts";
import {
  extractDirectiveInner,
  setCommentActiveInSource,
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

type MergeSnapshotResult =
  | { ok: true; source: string }
  | { ok: false; status: number; message: string };

function iterationApplyError(
  status: number,
  message: string
): IterationApplyResult {
  return { ok: false, status, message };
}

function mergeSnapshotError(
  status: number,
  message: string
): MergeSnapshotResult {
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

function mergeSnapshotAnchorIntoCurrentSource(
  currentSource: string,
  snapshotSource: string,
  found: FoundComment,
  id: string
): MergeSnapshotResult {
  const currentAst = parseSourceAst(currentSource);
  const snapshotAst = parseSourceAst(snapshotSource);
  const currentTarget =
    findJsxElementByCommentMarker(currentAst, id) ??
    findJsxElementByAnchor(currentAst, found.comment.anchor);
  const snapshotTarget =
    findJsxElementByCommentMarker(snapshotAst, id) ??
    findJsxElementByAnchor(snapshotAst, found.comment.anchor);

  if (!currentTarget) {
    return mergeSnapshotError(
      500,
      `could not find current JSX element for comment ${id}`
    );
  }
  if (!snapshotTarget) {
    return mergeSnapshotError(
      400,
      "snapshot is too old to safely activate; it pre-dates the anchor attribute."
    );
  }

  const currentHasMarker = extractDirectiveInner(currentSource, id) !== null;
  if (!currentHasMarker) {
    return mergeSnapshotError(
      500,
      `could not extract directive for comment ${id} from current source`
    );
  }

  try {
    Object.assign(currentTarget, snapshotTarget);
    const output = printAst(currentAst);
    assertValidTsx(output, "mergeSnapshotAnchorIntoCurrentSource");
    return { ok: true, source: output };
  } catch (err) {
    if (err instanceof WriteError) {
      return mergeSnapshotError(err.status, err.message);
    }
    return mergeSnapshotError(500, errorMessage(err));
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

  const currentRead = await readUtf8OrApplyError(found.absolutePath);
  if (!currentRead.ok) {
    return currentRead;
  }

  const snapshotRead = await readUtf8OrApplyError(snapshotPath);
  if (!snapshotRead.ok) {
    return snapshotRead;
  }

  const merged = mergeSnapshotAnchorIntoCurrentSource(
    currentRead.text,
    snapshotRead.text,
    found,
    id
  );
  if (!merged.ok) {
    return merged;
  }

  let sourceWithActive: string;
  try {
    sourceWithActive = setCommentActiveInSource(merged.source, id, v);
  } catch (err) {
    return writeErrorToApplyResult(err);
  }

  try {
    await atomicWriteText(found.absolutePath, sourceWithActive);
  } catch (err) {
    return writeErrorToApplyResult(err);
  }

  return { ok: true };
}
