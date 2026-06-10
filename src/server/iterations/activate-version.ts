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
  replaceCommentMarkerInSource,
  setCommentActiveInSource,
} from "../comments/writer-directive.ts";
import { WriteError } from "../comments/writer-errors.ts";
import { atomicWriteText } from "../platform/atomic-write.ts";
import { errorMessage } from "../platform/http.ts";
import { restoreAuxFilesForVersion } from "./aux-files.ts";
import { findVersionSnapshotPath } from "./manifest.ts";

export type IterationApplyResult =
  | { ok: true; writtenFiles: string[] }
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

type FullRevertResult = MergeSnapshotResult | { fallback: true };

/**
 * Re-apply the CURRENT directive (text/replies/resolved/active) for `commentId`
 * onto `sourceText`. A whole-file restore reverts marker metadata to the
 * snapshot era; this puts the live marker state back. Best-effort: returns the
 * input unchanged if the live marker or the snapshot slot is missing. The
 * caller still sets the activated comment's `active` afterward.
 */
function reapplyCurrentDirective(
  sourceText: string,
  currentSource: string,
  commentId: string
): string {
  const inner = extractDirectiveInner(currentSource, commentId);
  if (inner === null) {
    return sourceText;
  }
  try {
    return replaceCommentMarkerInSource(sourceText, commentId, inner);
  } catch {
    return sourceText;
  }
}

/**
 * Restore the comment's ENTIRE design for version `v`: the snapshot's whole
 * file (so edits the agent made outside the anchored element — parent wrappers,
 * imports, added markup — revert too), then graft the CURRENT element of every
 * OTHER comment in the file back in so sibling comments are left untouched.
 *
 * Returns `{ fallback: true }` when a whole-file restore is unsafe and the
 * caller should use the narrower element-only merge instead:
 *   - the snapshot pre-dates the comment marker (legacy `v{N}.tsx`), or
 *   - a sibling comment exists in the current file but not the snapshot
 *     (a whole-file restore would drop it).
 */
function fullDesignRevertSource(
  currentSource: string,
  snapshotSource: string,
  id: string,
  siblingIds: string[]
): FullRevertResult {
  const snapshotAst = parseSourceAst(snapshotSource);
  const currentAst = parseSourceAst(currentSource);

  // The target's marker must live in the snapshot — otherwise we can't safely
  // restore the whole file (legacy snapshot). Defer to the element-only merge.
  if (!findJsxElementByCommentMarker(snapshotAst, id)) {
    return { fallback: true };
  }
  if (extractDirectiveInner(currentSource, id) === null) {
    return mergeSnapshotError(
      500,
      `could not extract directive for comment ${id} from current source`
    );
  }

  for (const sibId of siblingIds) {
    const currentSibling = findJsxElementByCommentMarker(currentAst, sibId);
    if (!currentSibling) {
      // Not present in the live file — leave whatever the snapshot has.
      continue;
    }
    const snapshotSibling = findJsxElementByCommentMarker(snapshotAst, sibId);
    if (!snapshotSibling) {
      // The snapshot never saw this sibling; a whole-file restore would drop
      // it. Fall back to the surgical merge.
      return { fallback: true };
    }
    // Keep the sibling's currently-rendered markup instead of the snapshot's.
    Object.assign(snapshotSibling, currentSibling);
  }

  let output: string;
  try {
    output = printAst(snapshotAst);
    assertValidTsx(output, "fullDesignRevertSource");
  } catch (err) {
    if (err instanceof WriteError) {
      return mergeSnapshotError(err.status, err.message);
    }
    return mergeSnapshotError(500, errorMessage(err));
  }

  // Restore live marker metadata for the target and every sibling (the caller
  // overwrites the target's `active`).
  output = reapplyCurrentDirective(output, currentSource, id);
  for (const sibId of siblingIds) {
    output = reapplyCurrentDirective(output, currentSource, sibId);
  }

  return { ok: true, source: output };
}

/**
 * Resolve the merged source for activating version `v`: a full design revert
 * when it's safe, falling back to the element-only merge for duplicated anchors
 * (where only the marker-adjacent instance must switch) and legacy snapshots.
 */
function resolveActivatedSource(
  currentSource: string,
  snapshotSource: string,
  found: FoundComment,
  id: string
): MergeSnapshotResult {
  const elementMerge = () =>
    mergeSnapshotAnchorIntoCurrentSource(
      currentSource,
      snapshotSource,
      found,
      id
    );

  // A duplicated anchor means several elements share this comment; a whole-file
  // restore would switch them all, so keep the instance-precise element merge.
  const anchorAttr = `data-comment-anchor="${found.comment.anchor}"`;
  const anchorCount = currentSource.split(anchorAttr).length - 1;
  if (anchorCount > 1) {
    return elementMerge();
  }

  const full = fullDesignRevertSource(
    currentSource,
    snapshotSource,
    id,
    found.siblingIds
  );
  if ("fallback" in full) {
    return elementMerge();
  }
  return full;
}

export async function applyIterationVersionToSource(
  found: FoundComment,
  iterationRoots: string[],
  id: string,
  v: number,
  projectRoot: string
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

  const merged = resolveActivatedSource(
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

  // Restore files the agent changed outside the comment's file (e.g. a reused
  // component's definition), reverting any the target version did not touch.
  let auxWritten: string[] = [];
  try {
    auxWritten = await restoreAuxFilesForVersion(
      projectRoot,
      iterationRoots,
      v
    );
  } catch (err) {
    return writeErrorToApplyResult(err);
  }

  try {
    await atomicWriteText(found.absolutePath, sourceWithActive);
  } catch (err) {
    const currentActive = found.comment.active ?? 0;
    if (currentActive !== v) {
      try {
        await restoreAuxFilesForVersion(
          projectRoot,
          iterationRoots,
          currentActive
        );
      } catch {
        // Best-effort rollback; preserve the original write error.
      }
    }
    return writeErrorToApplyResult(err);
  }

  return { ok: true, writtenFiles: [found.absolutePath, ...auxWritten] };
}
